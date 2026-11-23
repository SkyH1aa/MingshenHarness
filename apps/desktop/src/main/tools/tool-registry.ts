import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type {
  ApprovalDecision,
  ApprovalRequest,
  FileChange,
  SessionView,
  ToolResultImage,
} from "../../shared/domain";
import { APP_VERSION } from "../../shared/release";
import { CodeIndexService, type IndexSnapshot } from "../agents/code-index-service";
import { isMemoryPath, MEMORY_DIRECTORY } from "../agents/project-memory-service";
import { chatToolRejection } from "../chat/agent-mode-policy";
import { authorOfficeDocument, renderDocumentHtml } from "../documents/document-author";
import {
  documentAssetPaths,
  documentAuthoringSchema,
  documentExtension,
  MAX_AUTHORED_DOCUMENT_BYTES,
  MAX_AUTHORING_IMAGE_BYTES,
} from "../documents/document-authoring-schema";
import { readDocxStructure } from "../documents/document-edit";
import { extractDocumentBuffer, isDocumentPath } from "../documents/document-extractor";
import { printDocumentPdf } from "../documents/document-pdf";
import {
  executeOfficeDocument,
  type OfficeDocumentResult,
  officeDocumentAssets,
} from "../documents/office-document";
import { officeDocumentSchema } from "../documents/office-document-schema";
import type { PermissionStore } from "../permissions/permission-store";
import { publicFetch } from "../security/network-policy";
import { dockerExecutable } from "../workspace/docker-path";
import { DOCKER_SECURITY_ARGS, DockerService } from "../workspace/docker-service";
import { createFileDiff } from "../workspace/file-diff";
import {
  listGuardedDirectory,
  readGuardedFile,
  statGuardedPath,
  writeGuardedFile,
} from "../workspace/guarded-workspace-io";
import {
  isNativeSandboxCleanupUnconfirmedError,
  type NativeCommandScope,
  NativeSandboxService,
} from "../workspace/native-sandbox-service";
import { safeFilePath } from "../workspace/safe-file-path";
import { BoundedOutput } from "./bounded-output";
import { HostCommandService, isHostCommandCleanupUnconfirmedError } from "./host-command-service";
import {
  type CommandLaunch,
  type CommandSessionInfo,
  PersistentCommandService,
} from "./persistent-command-service";
import {
  cacheableCommand,
  contentCacheKey,
  readonlyCommand,
  ToolResultCache,
} from "./tool-result-cache";

const MAX_FILE_BYTES = 2_000_000;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_TOOL_OUTPUT = 80_000;
const DEFAULT_COMMAND_TIMEOUT = 120_000;
const WEB_REQUEST_TIMEOUT_MS = 90_000;
const MAX_LIST_ENTRIES = 600;
const WINDOWS_POWERSHELL = process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "release",
  ".next",
  ".turbo",
  ".cache",
]);

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionResult {
  output: string;
  /** Internal capture for paginated recovery; removed before sending to a provider. */
  fullOutput?: string;
  isError: boolean;
  cleanupUnconfirmed?: boolean;
  officeVerification?: OfficeDocumentResult["verification"];
  fileChange?: FileChange;
  fileChanges?: FileChange[];
  images?: ToolResultImage[];
  commandSession?: { id: string; running: boolean; unreadOutputChars?: number };
}

export interface ToolExecutionContext {
  session: SessionView;
  runId: string;
  toolCallId: string;
  toolName: string;
  signal: AbortSignal;
  permissions: PermissionStore;
  dockerImage?: string;
  contextEpoch?: string;
  forceApproval?: boolean;
  forceReadApprovalPaths?: ReadonlySet<string>;
  forceWriteApprovalPaths?: ReadonlySet<string>;
  indexStore?: {
    load(key: string): IndexSnapshot | null;
    save(key: string, snapshot: IndexSnapshot): void;
  };
  observeFile?: (path: string, version: string) => void;
  beforeFileWrite?: (path: string, version: string) => Promise<void>;
  onEffectStart?: (() => void) | undefined;
  requestApproval: (request: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalDecision>;
}

const readFileSchema = z
  .object({
    path: z.string().min(1).max(32_767),
    refresh: z.boolean().optional(),
    structure: z.boolean().optional(),
    render: z.boolean().optional(),
    start_line: z.number().int().min(1).max(2_000_001).optional(),
    end_line: z.number().int().min(1).max(2_000_001).optional(),
    limit: z.number().int().min(1).max(2_500).optional(),
    char_offset: z.number().int().min(0).max(2_000_000).optional(),
    max_chars: z.number().int().min(100).max(80_000).optional(),
  })
  .refine((args) => (args.end_line ?? Infinity) >= (args.start_line ?? 1), {
    message: "end_line must be greater than or equal to start_line.",
  });

const viewImageSchema = z.object({ path: z.string().min(1).max(32_767) });

const writeFileSchema = z.object({
  path: z.string().min(1).max(32_767),
  content: z.string().max(2_000_000),
});

const deleteFileSchema = z.object({
  path: z.string().min(1).max(32_767),
});

const replaceFileSchema = z.object({
  path: z.string().min(1).max(32_767),
  old_text: z.string().min(1).max(500_000),
  new_text: z.string().max(500_000),
});

const listFilesSchema = z.object({
  path: z.string().max(32_767).optional(),
  depth: z.number().int().min(1).max(8).optional(),
});

const searchFilesSchema = z.object({
  query: z.string().min(1).max(500),
  path: z.string().max(32_767).optional(),
  max_results: z.number().int().min(1).max(200).optional(),
});

const globFilesSchema = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().max(32_767).optional(),
  max_results: z.number().int().min(1).max(500).optional(),
});

const webFetchSchema = z.object({
  url: z.string().url().max(8_192),
  max_chars: z.number().int().min(1_000).max(200_000).optional(),
});

const webSearchSchema = z.object({
  query: z.string().min(1).max(500),
  max_results: z.number().int().min(1).max(20).optional(),
});

const runCommandSchema = z.object({
  command: z.string().min(1).max(20_000),
  cwd: z.string().max(32_767).optional(),
  timeout_ms: z.number().int().min(1_000).max(600_000).optional(),
});

const execCommandSchema = runCommandSchema.extend({
  timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
  yield_time_ms: z.number().int().min(0).max(30_000).optional(),
  max_output_chars: z.number().int().min(100).max(80_000).optional(),
});

const writeStdinSchema = z
  .object({
    session_id: z.string().uuid(),
    chars: z.string().max(20_000).optional(),
    close_stdin: z.boolean().optional(),
    terminate: z.boolean().optional(),
    yield_time_ms: z.number().int().min(0).max(30_000).optional(),
    max_output_chars: z.number().int().min(100).max(80_000).optional(),
  })
  .refine((args) => !(args.terminate && (args.chars || args.close_stdin)), {
    message: "terminate cannot be combined with input or close_stdin.",
  });

const applyPatchSchema = z.object({
  patch: z.string().min(1).max(1_000_000),
});

const lspSchema = z.object({
  operation: z.enum([
    "definition",
    "references",
    "hover",
    "documentSymbol",
    "workspaceSymbol",
    "implementation",
  ]),
  path: z.string().min(1).max(32_767).optional(),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  query: z.string().max(500).optional(),
});

const codeIndexSchema = z.object({
  operation: z
    .enum(["symbols", "definitions", "references", "callers", "callees", "graph"])
    .optional(),
  query: z.string().max(500).optional(),
  path: z.string().max(32_767).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  max_files: z.number().int().min(1).max(20_000).optional(),
  max_depth: z.number().int().min(1).max(64).optional(),
});

const createDocumentSchema = documentAuthoringSchema;

export function validateChainToolArguments(name: string, args: unknown): void {
  const schemas: Record<string, z.ZodType> = {
    read_file: readFileSchema,
    read_document: readFileSchema,
    list_files: listFilesSchema,
    search_files: searchFilesSchema,
    glob_files: globFilesSchema,
    write_file: writeFileSchema,
    replace_in_file: replaceFileSchema,
    apply_patch: applyPatchSchema,
    delete_file: deleteFileSchema,
    run_command: runCommandSchema,
    code_index: codeIndexSchema,
    create_document: createDocumentSchema,
    office_document: officeDocumentSchema,
  };
  const schema = schemas[name];
  if (!schema) throw new Error(`Execution chain has no argument validator for ${name}.`);
  schema.parse(args);
}

const READ_RANGE_PROPERTIES = {
  start_line: {
    type: "integer",
    minimum: 1,
    description: "One-based first line. Follow the continuation cursor to read later lines.",
  },
  end_line: { type: "integer", minimum: 1, description: "Optional inclusive last line." },
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 2500,
    description: "Maximum lines in this page, at most 2500.",
  },
  char_offset: {
    type: "integer",
    minimum: 0,
    description: "UTF-16 character offset within start_line, for continuing a very long line.",
  },
  max_chars: {
    type: "integer",
    minimum: 100,
    maximum: 80000,
    description: "Page character budget; defaults to 40000. Continuation is explicit.",
  },
};

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: "code_index",
    description:
      "Incrementally query local JS/TS, Python, Go, Rust, Java, C/C++, C# AST definitions, references, callers, callees and import edges. Use this before full file reads. Syntax-level candidates report ambiguity; validate dynamic dispatch with LSP/source. All reads retain workspace approval and isolation.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["symbols", "definitions", "references", "callers", "callees", "graph"],
        },
        query: { type: "string" },
        path: {
          type: "string",
          description: "Optional workspace-relative file or directory filter.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        max_files: { type: "integer", minimum: 1, maximum: 20000 },
        max_depth: { type: "integer", minimum: 1, maximum: 64 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read numbered text with bounded pages and explicit continuation cursors, or extract DOC/DOCX, PDF, XLSX/XLS, PPTX and ODT documents. Use start_line/limit and char_offset for long lines. Scanned PDFs use offline Chinese/English OCR; handwriting may be inaccurate. For documents use this tool instead of external parsers.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the workspace." },
        refresh: {
          type: "boolean",
          description:
            "Return the requested page even if unchanged; useful after compaction or when previous contents are unavailable.",
        },
        structure: {
          type: "boolean",
          description:
            "DOCX only: return body block/paragraph indices, exact text and source SHA-256 for localized edits.",
        },
        render: {
          type: "boolean",
          description:
            "PDF only: return bounded page images for visual QA with an image-capable model. Inspect any page-limit warning.",
        },
        ...READ_RANGE_PROPERTIES,
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_document",
    description:
      "Extract readable text from DOC/DOCX, PDF, XLSX/XLS, PPTX or ODT using built-in parsers. For existing DOCX edits, pass structure:true to read indexed body blocks and paragraphs (including table cells), paragraph text with linear math summaries and source SHA-256; paginate with the normal read cursors. Scanned PDFs use offline Chinese/English OCR. Do not shell out to external document tools.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the workspace." },
        refresh: { type: "boolean" },
        structure: {
          type: "boolean",
          description: "DOCX indices and source SHA-256 for edit operations.",
        },
        render: {
          type: "boolean",
          description:
            "PDF only: return page images for visual layout review; page/image budgets are reported.",
        },
        ...READ_RANGE_PROPERTIES,
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "view_image",
    description:
      "Read a local PNG, JPEG, WebP or GIF from the current workspace and return its pixels to an image-capable model. Use to inspect screenshots, generated images and document page renders. No URLs or SVG; the normal file approval and isolation gateway applies.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Image path inside the workspace." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "create_document",
    description:
      "Create DOCX/PPTX/PDF, fill a DOCX template, or edit an existing DOCX locally. For old drafts, first read_document with structure:true; then use edit:{path,expected_sha256,operations}. Operations: replace_text {paragraph,old_text,new_text} replaces a unique inline match across runs while retaining surrounding run formatting; replace_blocks {start_block,end_block,blocks} replaces/deletes an inclusive body range without placeholders; format_paragraph {paragraph,layout} changes paragraph layout. Indices refer to the original SHA-256; operations must not overlap. Protected ranges fail without writing. Source requires separate read approval; output defaults to a new file. template and edit are mutually exclusive; omit top-level blocks/slides and document-level layout in both modes. DOCX supports native editable equations, Markdown, rich text, links, footnotes, TOC, charts, tables and approved local images. DOCX/PDF heading/paragraph/rich_paragraph/equation support layout (spacing in points, indentation in inches, line-spacing multiplier, alignment and pagination); tables support column_widths as relative weights and literal or {blocks:[...]} cells. PPTX cells are strings; no layout, rich text or equations. PDF typesets equations; charts/TOC/footnotes require DOCX. Templates still use unique whole-paragraph {{placeholder}} markers. Unsupported math fails without rasterizing. Do not overwrite unless overwrite:true.",
    parameters: z.toJSONSchema(createDocumentSchema, { target: "draft-7" }),
  },
  {
    name: "office_document",
    description:
      "WorkAgent structured Office workflow. inspect returns DOCX/XLSX/PPTX package structure and source SHA. create_spreadsheet creates native editable XLSX with styled cells, formulas, filters and tables. edit_spreadsheet requires the inspected source SHA and supports sheets, ranges, styles, merges, columns, filters and native tables. edit_presentation requires source SHA and edits supported shape/placeholder text, table cells and notes without reserializing unrelated parts. verify performs package/content checks and can optionally use installed Microsoft Office COM for real Excel recalculation and Word/Excel/PowerPoint PDF export; COM is unavailable in isolated/protected/child workflows and results must say so. Formula caches written by ExcelJS are not evidence of recalculation. Macros, signatures, external links, ActiveX, OLE, pivot caches, slicers and unsupported embedded objects are rejected. Never claim rendering or recalculation succeeded when verify reports unavailable/failed/skipped.",
    parameters: z.toJSONSchema(officeDocumentSchema, { target: "draft-7" }),
  },
  {
    name: "write_file",
    description:
      "Write the complete contents of a UTF-8 file. Read the current file first and avoid overwriting unrelated user changes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the workspace." },
        content: { type: "string", description: "Complete new file contents." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "replace_in_file",
    description:
      "Replace one exact occurrence of old_text with new_text in a UTF-8 file. Fails if old_text is missing or ambiguous.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the workspace." },
        old_text: { type: "string", description: "Exact text that must occur exactly once." },
        new_text: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a Codex-style patch with *** Begin Patch, *** Add File, *** Update File and *** Delete File sections. Use this instead of write_file when patch-only mode is enabled.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description:
            "Patch text using *** Begin Patch / *** End Patch and Add, Update or Delete file sections.",
        },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a single file after the required permission checks. Directories are rejected; use an approved command for directory removal.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the workspace." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description:
      "List files and directories under a path. Heavy generated directories are skipped.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path. Defaults to the workspace." },
        depth: {
          type: "number",
          description: "Maximum recursive depth from 1 to 8. Defaults to 2.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description: "Search UTF-8 text files for a case-insensitive literal string.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text to find." },
        path: { type: "string", description: "Directory path. Defaults to the workspace." },
        max_results: { type: "number", description: "Maximum matches, 1 to 200." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "glob_files",
    description:
      "Find files by wildcard pattern such as **/*.ts or src/**/*.tsx. Results are sorted by modification time.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern relative to the workspace." },
        path: { type: "string", description: "Optional directory to search from." },
        max_results: { type: "number", description: "Maximum matches, 1 to 500." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch a specific HTTP or HTTPS page and return readable text. Use web_search first when the URL is unknown.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP or HTTPS URL." },
        max_chars: { type: "number", description: "Maximum returned characters." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "web_search",
    description:
      "Search the web using DuckDuckGo with Bing RSS fallback. Returns titles, URLs and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        max_results: { type: "number", description: "Maximum results, 1 to 20." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_interrupted",
    description:
      "After an interrupted side effect, inspect actual state with read-only tools and submit their successful call IDs plus a factual summary. The host asks the user to confirm before unlocking new mutations. Never replay confirmed operations.",
    parameters: {
      type: "object",
      properties: {
        evidence_call_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        summary: { type: "string", minLength: 1, maxLength: 4000 },
      },
      required: ["evidence_call_ids", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "begin_plan_step",
    description:
      "Begin a persisted plan step by ID before executing its tools. The engine validates dependencies and stops at a configured breakpoint before side effects. Use for every step transition; update_todos may also transition steps.",
    parameters: {
      type: "object",
      properties: { step_id: { type: "string" } },
      required: ["step_id"],
      additionalProperties: false,
    },
  },
  {
    name: "lsp",
    description:
      "Query language-server code intelligence: definitions, references, hover, document symbols, workspace symbols and implementations.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "definition",
            "references",
            "hover",
            "documentSymbol",
            "workspaceSymbol",
            "implementation",
          ],
        },
        path: {
          type: "string",
          description:
            "Absolute path or workspace-relative file path. Required except for workspaceSymbol.",
        },
        line: { type: "number", description: "One-based line number." },
        column: { type: "number", description: "One-based column number." },
        query: {
          type: "string",
          description: "Workspace symbol query.",
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run a PowerShell command in the workspace. Use for tests, builds, Git inspection, and commands that do not have a dedicated tool.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "PowerShell command to execute." },
        cwd: { type: "string", description: "Working directory. Defaults to the workspace." },
        timeout_ms: { type: "number", description: "Timeout in milliseconds." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "exec_command",
    description:
      "Start a PowerShell command with a managed persistent pipe session. Use for long builds, development servers or programs that read stdin. Returns early with a command_session id when still running; poll or send input with write_stdin. This is not a PTY and TTY-only programs are unsupported. The process is owned by this session/run and is stopped when the run ends.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "PowerShell command to execute." },
        cwd: { type: "string", description: "Working directory, defaults to the workspace." },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 3600000,
          description: "Total process lifetime, defaults to 1800000 milliseconds.",
        },
        yield_time_ms: {
          type: "integer",
          minimum: 0,
          maximum: 30000,
          description: "Wait before returning; defaults to 1000 milliseconds.",
        },
        max_output_chars: { type: "integer", minimum: 100, maximum: 80000 },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "write_stdin",
    description:
      "Poll a command_session started by exec_command in this session/run, optionally sending stdin, closing stdin or terminating it. Empty chars only polls. Input requires a fresh permission check; it does not inherit an earlier command-prefix approval. Poll again when unread output remains.",
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "The command_session id from exec_command." },
        chars: { type: "string", description: "Optional text to write to the process stdin." },
        close_stdin: { type: "boolean", description: "Send EOF after optional chars." },
        terminate: { type: "boolean", description: "Stop the process tree and wait for cleanup." },
        yield_time_ms: { type: "integer", minimum: 0, maximum: 30000 },
        max_output_chars: { type: "integer", minimum: 100, maximum: 80000 },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "spawn_subagent",
    description:
      "Start a background subagent for an independent task and return a task id immediately. Proactively delegate suitable independent research, implementation or verification while continuing your own work. The host queues work above the configured concurrent limit. Specify separate file ownership for edits. The child inherits the session settings and cannot create another subagent. Call wait_subagents before the final answer to collect results.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "A complete, self-contained task for the subagent.",
        },
        context: {
          type: "string",
          description: "Optional facts, constraints or file paths the subagent needs.",
        },
        label: {
          type: "string",
          description: "Short label shown in the tool trace.",
        },
        agent: {
          type: "string",
          description: "Optional Agent profile id or name configured by the user.",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_subagents",
    description:
      "Wait for all not-yet-collected subagent tasks from this run and return their actual results. Use after completing your independent work and before your final answer. Do not invent unfinished results.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "review_plan",
    description:
      "Decide whether the previous active plan still applies to the latest user request before continuing work. Keep related unfinished work and its progress; discard abandoned, superseded or unrelated work. Clearing only removes the active todo list, not history, saved project plans or safety recovery barriers. No user approval is needed for this metadata decision.",
    parameters: {
      type: "object",
      properties: {
        revision: { type: "integer", description: "Current authoritative plan revision." },
        action: { type: "string", enum: ["keep", "discard"] },
        reason: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["revision", "action", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "update_todos",
    description:
      "Replace the current session todo list with structured tasks. Use for multi-step work, mark one task in_progress at a time, and complete tasks as work finishes.",
    parameters: {
      type: "object",
      properties: {
        revision: {
          type: "integer",
          description:
            "Current plan revision from the previous tool result. Detects concurrent user edits.",
        },
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable task id. Omit for a new task." },
              content: { type: "string", description: "Concrete task description." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "Stable IDs of prerequisite steps. Must form an acyclic graph.",
              },
            },
            required: ["content", "status", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description:
      "Proactively ask the user when a missing requirement, preference or decision changes the work. Pause this task and wait for real answers, then continue. Ask 1-3 focused questions; each can be single-select or multi-select with at most 4 title/description options. The application always adds Other for custom text; never include it yourself. Available in work and planning conversations, subject to Agent tool policy. This is not permission approval.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          description:
            "Prefer one question. Bundle only closely related decisions. Do not invent the user's answer.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                maxLength: 80,
                description: "Unique stable question id, such as output_format.",
              },
              header: {
                type: "string",
                maxLength: 80,
                description: "Short topic shown above the question.",
              },
              question: { type: "string", minLength: 1, maxLength: 2000 },
              multi_select: {
                type: "boolean",
                description:
                  "False for one mutually exclusive choice; true when multiple choices may apply.",
              },
              options: {
                type: "array",
                maxItems: 4,
                description:
                  "Up to 4 distinct choices. Put a recommendation first when justified. Use [] for a free-text-only question. Other is added by the application.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      minLength: 1,
                      maxLength: 120,
                      description: "Short option title.",
                    },
                    description: {
                      type: "string",
                      minLength: 1,
                      maxLength: 1000,
                      description: "One sentence explaining the result or tradeoff.",
                    },
                  },
                  required: ["label", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["id", "header", "question", "multi_select", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_open",
    description:
      "Open a Chrome-compatible or Edge-compatible browser inside the Harness workspace. Use browser_* tools afterwards to navigate, inspect and operate the embedded page.",
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["chrome", "edge"] },
        url: { type: "string", description: "Optional URL to open." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "github_search_repositories",
    description:
      "Search public GitHub repositories through the GitHub API and return repository names, descriptions, stars and URLs without opening a browser.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Repository search query." },
        limit: { type: "number", description: "Maximum results from 1 to 20." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "github_list_pull_requests",
    description: "List pull requests for a GitHub repository.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name form." },
        state: { type: "string", enum: ["open", "closed", "all"] },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "github_get_pull_request",
    description: "Read a GitHub pull request, including its description and URL.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name form." },
        number: { type: "number", description: "Pull request number." },
      },
      required: ["repo", "number"],
      additionalProperties: false,
    },
  },
  {
    name: "github_list_issues",
    description: "List issues in a GitHub repository, excluding pull requests.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name form." },
        state: { type: "string", enum: ["open", "closed", "all"] },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "github_list_workflow_runs",
    description: "List recent GitHub Actions workflow runs for a repository.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name form." },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "github_create_issue",
    description:
      "Create a GitHub issue. Requires a connected GitHub token with issue write access.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name form." },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["repo", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "github_add_pr_comment",
    description:
      "Add a comment to a pull request. Requires a connected GitHub token with write access.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/name form." },
        number: { type: "number", description: "Pull request number." },
        body: { type: "string" },
      },
      required: ["repo", "number", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate the current controlled browser to an HTTP or HTTPS URL.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read the current browser title, URL and Chromium accessibility tree before clicking or typing.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "browser_click",
    description:
      "Click in the controlled browser using a CSS selector, visible text, or viewport coordinates.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_type",
    description:
      "Enter text into the current browser. Prefer a CSS selector; without one, text is inserted at the focused element.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        selector: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_press_key",
    description: "Press Enter, Tab, Escape or an arrow key in the controlled browser.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the active page vertically by a pixel amount.",
    parameters: {
      type: "object",
      properties: { pixels: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Capture the visible browser page, save a local PNG and return its pixels to image-capable models for visual verification.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "browser_back",
    description: "Go back one page in the controlled browser.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "browser_close",
    description: "Close the current session's controlled browser window.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

function truncate(value: string, limit = MAX_TOOL_OUTPUT): string {
  return value.length > limit ? `${value.slice(0, limit)}\n… output truncated` : value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createWebRequestBudget(parentSignal: AbortSignal) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    const error = new Error("Web request exceeded the 90-second timeout.");
    error.name = "TimeoutError";
    timeoutController.abort(error);
  }, WEB_REQUEST_TIMEOUT_MS);

  return {
    signal: AbortSignal.any([parentSignal, timeoutController.signal]),
    timedOut: timeoutController.signal,
    dispose: () => clearTimeout(timeout),
  };
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function webRequestFailure(
  error: unknown,
  action: "网页读取" | "网页搜索",
  parentSignal: AbortSignal,
  timedOutSignal: AbortSignal,
): string {
  if (parentSignal.aborted) return `${action}已取消。`;
  if (timedOutSignal.aborted) return `${action}超时（90 秒上限）。`;
  return `${action}失败：${errorText(error)}`;
}

function resolveToolPath(input: string | undefined, workspacePath: string | null): string {
  if (!input) {
    if (!workspacePath) {
      throw new Error("当前会话没有工作目录。");
    }
    return resolve(workspacePath);
  }

  if (isAbsolute(input)) {
    return resolve(input);
  }

  if (!workspacePath) {
    throw new Error("相对路径需要先选择工作目录。");
  }
  return resolve(workspacePath, input);
}

function relativeForDisplay(path: string, workspacePath: string | null): string {
  if (!workspacePath) {
    return path;
  }
  const rel = relative(workspacePath, path);
  return rel.startsWith("..") ? path : rel || ".";
}

function isProbablyText(buffer: Buffer): boolean {
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
    return buffer.length % 2 === 0 && !decodeText(buffer).includes("\0");
  if (buffer.includes(0)) {
    return false;
  }
  return true;
}

function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function binaryReadMessage(target: string): string {
  return `BINARY_FILE_UNSUPPORTED: ${target}\nThis file is not readable text. Use read_document for supported Office/PDF documents. For images, attach the image to a conversation with an image-capable model; do not retry reading binary data as text.`;
}

function editableText(buffer: Buffer, target: string): string {
  if (!isProbablyText(buffer)) throw new Error(binaryReadMessage(target));
  return decodeText(buffer);
}

async function existingMemoryPaths(workspace: string): Promise<string[]> {
  const paths: string[] = [];
  for (const name of [MEMORY_DIRECTORY, ".harness-tencent-memory"]) {
    const target = join(workspace, name);
    try {
      await lstat(target);
      paths.push(await safeFilePath(workspace, target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return paths;
}

type ReadFileArguments = z.infer<typeof readFileSchema>;

function readRangeKey(args: ReadFileArguments): string {
  return JSON.stringify({
    start: args.start_line ?? 1,
    end: args.end_line ?? null,
    limit: args.limit ?? 2500,
    offset: args.char_offset ?? 0,
    chars: args.max_chars ?? 40_000,
  });
}

function hasReadRange(args: ReadFileArguments): boolean {
  return [args.start_line, args.end_line, args.limit, args.char_offset, args.max_chars].some(
    (value) => value !== undefined,
  );
}

function formatNumberedLines(content: string, args: ReadFileArguments): string {
  const lines = content.split(/\r?\n/);
  const start = args.start_line ?? 1;
  if (start > lines.length) return `End of file. Total lines: ${lines.length}.`;
  const last = Math.min(lines.length, args.end_line ?? lines.length);
  const pageEnd = Math.min(last, start + (args.limit ?? 2500) - 1);
  const firstOffset = args.char_offset ?? 0;
  const firstLine = lines[start - 1] ?? "";
  if (firstOffset > firstLine.length)
    throw new Error("READ_RANGE_INVALID: char_offset is beyond start_line. Start at offset 0.");
  if (
    firstOffset > 0 &&
    /[\uD800-\uDBFF]/.test(firstLine[firstOffset - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(firstLine[firstOffset] ?? "")
  )
    throw new Error("READ_RANGE_INVALID: char_offset must not split a UTF-16 character.");
  const width = String(pageEnd).length;
  const output: string[] = [];
  let remaining = args.max_chars ?? 40_000;
  let nextLine = start;
  let nextOffset = firstOffset;
  for (let line = start; line <= pageEnd; line++) {
    const text = lines[line - 1] ?? "";
    const offset = line === start ? firstOffset : 0;
    const prefix = `${String(line).padStart(width, " ")} | `;
    const capacity = Math.max(0, remaining - prefix.length - 1);
    if (capacity === 0) {
      nextLine = line;
      nextOffset = offset;
      break;
    }
    let end = Math.min(text.length, offset + capacity);
    if (
      end > offset &&
      /[\uD800-\uDBFF]/.test(text[end - 1] ?? "") &&
      /[\uDC00-\uDFFF]/.test(text[end] ?? "")
    )
      end--;
    if (end === offset && offset < text.length) {
      nextLine = line;
      nextOffset = offset;
      break;
    }
    const excerpt = text.slice(offset, end);
    output.push(`${prefix}${excerpt}`);
    remaining -= prefix.length + excerpt.length + 1;
    if (offset + excerpt.length < text.length) {
      nextLine = line;
      nextOffset = offset + excerpt.length;
      break;
    }
    nextLine = line + 1;
    nextOffset = 0;
  }
  const more = nextLine <= last;
  return [
    `Range: lines ${start}-${Math.min(nextLine - (nextOffset ? 0 : 1), pageEnd)} of ${lines.length}${firstOffset ? `; starting character offset ${firstOffset}` : ""}.`,
    ...output,
    ...(more
      ? [
          `Next read_file: ${JSON.stringify({
            path: args.path,
            start_line: nextLine,
            ...(nextOffset ? { char_offset: nextOffset } : {}),
            ...(args.end_line !== undefined ? { end_line: args.end_line } : {}),
            limit: args.limit ?? 2500,
            max_chars: args.max_chars ?? 40_000,
          })}`,
        ]
      : []),
  ].join("\n");
}

function globExpression(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] as string;
    const next = normalized[index + 1];
    if (current === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (current === "*") {
      expression += "[^/]*";
    } else if (current === "?") {
      expression += "[^/]";
    } else {
      expression += current.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`, "i");
}

function readableHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(?:br|p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value: string): string {
  return readableHtml(value.replace(/<[^>]+>/g, " "));
}

export function isDangerousCommand(command: string): string | null {
  const lower = command.toLowerCase();

  const hardBlocked: Array<[RegExp, string]> = [
    [/\bformat(?:\.com|\.exe)?\s+(?:[a-z]:|\/[a-z])/i, "禁止格式化磁盘。"],
    [/\b(?:format-volume|clear-disk|initialize-disk)\b/i, "禁止格式化或重新初始化磁盘。"],
    [/\bdiskpart\b/i, "禁止直接操作磁盘分区。"],
    [/\bshutdown(?:\.exe)?\b/i, "禁止关机命令。"],
    [/\brestart-computer\b/i, "禁止重启系统。"],
    [/\bstop-computer\b/i, "禁止关闭系统。"],
    [/\bbcdedit\b/i, "禁止修改启动配置。"],
    [/\bgit\s+reset\s+--hard\b/i, "禁止丢弃未提交工作。"],
    [/\bgit\s+clean\s+-[a-z]*f/i, "禁止强制清理工作区。"],
    [
      /\bremove-item\b[^\n]*-recurse[^\n]*(c:\\windows|c:\\users|\$env:userprofile|%userprofile%|c:\\)/i,
      "禁止递归删除系统或用户目录。",
    ],
    [
      /\brd\s+\/s\b[^\n]*(c:\\windows|c:\\users|%userprofile%|c:\\)/i,
      "禁止递归删除系统或用户目录。",
    ],
    [
      /\bdel\s+\/[^\n]*\/s[^\n]*(c:\\windows|c:\\users|%userprofile%|c:\\)/i,
      "禁止递归删除系统或用户目录。",
    ],
    [/\breg\s+delete\b[^\n]*hklm/i, "禁止删除系统注册表项。"],
  ];

  for (const [pattern, reason] of hardBlocked) {
    if (pattern.test(command)) {
      return reason;
    }
  }

  if (lower.includes(":$env:userprofile") && lower.includes("-recurse")) {
    return "禁止递归删除用户目录。";
  }

  return null;
}

function documentWorkaroundMessage(command: string): string | null {
  const lower = command.toLowerCase();
  const mentionsDocument = /\.(doc|docx|pdf|xlsx|xls|pptx|odt)\b/i.test(command);
  const usesWorkaround =
    lower.includes("system.io.compression") ||
    lower.includes("zipfile") ||
    lower.includes("word/document.xml") ||
    lower.includes("pandoc") ||
    lower.includes("pdftotext") ||
    lower.includes("libreoffice") ||
    lower.includes("soffice");

  return mentionsDocument && usesWorkaround
    ? "不要通过 PowerShell 或外部程序解析 Office/PDF 文档。请改用 read_document 或 read_file，它们使用应用内置解析器。"
    : null;
}

async function walkFiles(
  root: string,
  maxDepth: number,
  limit = MAX_LIST_ENTRIES,
): Promise<Array<{ path: string; directory: boolean; size: number }>> {
  const metadata = await stat(root);
  if (metadata.isFile()) return [{ path: root, directory: false, size: metadata.size }];
  if (!metadata.isDirectory()) throw new Error("The search path must be a file or directory.");
  const results: Array<{ path: string; directory: boolean; size: number }> = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];

  while (queue.length > 0 && results.length < limit) {
    const item = queue.shift();
    if (!item) {
      break;
    }
    const entries = await readdir(item.path, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) {
        break;
      }
      const fullPath = join(item.path, entry.name);
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      let size = 0;
      if (entry.isFile()) {
        try {
          size = (await stat(fullPath)).size;
        } catch {
          size = 0;
        }
      }
      results.push({ path: fullPath, directory: entry.isDirectory(), size });
      if (entry.isDirectory() && item.depth + 1 < maxDepth) {
        queue.push({ path: fullPath, depth: item.depth + 1 });
      }
    }
  }

  return results;
}

function killProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((done) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: 10_000 },
      () => done(),
    );
  });
}

interface PatchBlock {
  operation: "add" | "update" | "delete";
  path: string;
  body: string[];
}

function parsePatchBlocks(patch: string): PatchBlock[] {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trim() !== "*** Begin Patch") {
    throw new Error("Patch 必须以 *** Begin Patch 开始。");
  }
  if (!lines.some((line) => line.trim() === "*** End Patch")) {
    throw new Error("Patch 缺少 *** End Patch。");
  }
  const blocks: PatchBlock[] = [];
  let current: PatchBlock | null = null;
  for (const line of lines.slice(1)) {
    if (line.trim() === "*** End Patch") {
      break;
    }
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trim());
    if (header) {
      if (current) {
        blocks.push(current);
      }
      current = {
        operation: header[1]?.toLowerCase() as PatchBlock["operation"],
        path: header[2]?.trim() ?? "",
        body: [],
      };
      continue;
    }
    if (current) {
      current.body.push(line);
    }
  }
  if (current) {
    blocks.push(current);
  }
  if (blocks.length === 0) {
    throw new Error("Patch 中没有文件操作。");
  }
  return blocks;
}

function applyUpdatePatch(content: string, body: string[]): string {
  const hunks: Array<{ oldText: string; newText: string }> = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];
  const flush = () => {
    if (oldLines.length === 0 && newLines.length === 0) {
      return;
    }
    hunks.push({ oldText: oldLines.join("\n"), newText: newLines.join("\n") });
    oldLines = [];
    newLines = [];
  };

  for (const line of body) {
    if (line.startsWith("@@")) {
      flush();
      continue;
    }
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  flush();

  let next = content;
  for (const hunk of hunks) {
    if (!hunk.oldText) {
      next += `${next && !next.endsWith("\n") ? "\n" : ""}${hunk.newText}`;
      continue;
    }
    const first = next.indexOf(hunk.oldText);
    const last = next.lastIndexOf(hunk.oldText);
    if (first === -1) {
      throw new Error(`Patch 找不到待替换内容：${hunk.oldText.slice(0, 120)}`);
    }
    if (first !== last) {
      throw new Error("Patch 的待替换内容出现多次，无法安全定位。");
    }
    next = next.slice(0, first) + hunk.newText + next.slice(first + hunk.oldText.length);
  }
  return next;
}

export class ToolRegistry {
  private readonly codeIndex = new CodeIndexService();
  private readonly cache = new ToolResultCache();
  constructor(
    private readonly nativeSandbox = new NativeSandboxService(),
    private readonly commands = new PersistentCommandService(),
    private readonly hostCommands = new HostCommandService(),
  ) {}
  invalidateCache(): void {
    this.cache.clear();
  }
  descriptors(): ToolDescriptor[] {
    return TOOL_DESCRIPTORS;
  }

  commandSessions(runId: string): CommandSessionInfo[] {
    return this.commands.list(runId);
  }

  hasRunningCommands(runId: string): boolean {
    return (
      this.commandSessions(runId).some((command) => command.running) ||
      this.hostCommands.hasRunningCommands(runId)
    );
  }

  async cancelRun(runId: string): Promise<void> {
    await this.settleCleanup(
      [
        this.commands.cancelRun(runId),
        this.nativeSandbox.cancelRun(runId),
        this.hostCommands.cancelRun(runId),
      ],
      `Cleanup for run ${runId} could not be fully confirmed.`,
    );
  }

  async shutdown(): Promise<void> {
    await this.settleCleanup(
      [this.commands.shutdown(), this.nativeSandbox.shutdown(), this.hostCommands.shutdown()],
      "Tool cleanup could not be fully confirmed during shutdown.",
    );
  }

  confirmRunStopped(runId: string): void {
    const failures: unknown[] = [];
    for (const confirm of [
      () => this.commands.confirmRunStopped(runId),
      () => this.nativeSandbox.confirmRunStopped(runId),
      () => this.hostCommands.confirmRunStopped(runId),
    ]) {
      try {
        confirm();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        `Cleanup confirmation for run ${runId} could not be fully applied.`,
      );
  }

  private nativeScope(context: ToolExecutionContext): NativeCommandScope {
    return {
      sessionId: context.session.id,
      runId: context.runId,
      toolCallId: context.toolCallId,
    };
  }

  private async settleCleanup(operations: Promise<void>[], message: string): Promise<void> {
    const results = await Promise.allSettled(operations);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length === 0) return;
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, message);
  }

  async execute(
    name: string,
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const chatDenied = chatToolRejection(context.session, name);
      if (chatDenied) return chatDenied;
      if (
        [
          "write_file",
          "replace_in_file",
          "delete_file",
          "apply_patch",
          "create_document",
          "office_document",
        ].includes(name)
      ) {
        const args = rawArguments as Record<string, unknown>;
        const paths =
          name === "apply_patch"
            ? [
                ...String(args?.patch ?? "").matchAll(
                  /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm,
                ),
              ].map((match) => match[1] ?? "")
            : [String(args?.path ?? "")];
        if (
          paths.some((path) =>
            isMemoryPath(resolve(context.session.workspacePath ?? process.cwd(), path)),
          )
        )
          return {
            output: "Project memory is broker-managed. Use memory_write; Subagents are read only.",
            isError: true,
          };
      }
      if (name === "code_index") return await this.queryCodeIndex(rawArguments, context);
      if (name === "office_document") {
        const parsed = officeDocumentSchema.safeParse(rawArguments);
        if (
          parsed.success &&
          (parsed.data.operation === "create_spreadsheet" ||
            parsed.data.operation === "edit_spreadsheet" ||
            parsed.data.operation === "edit_presentation")
        )
          this.cache.clear();
      }
      if (
        [
          "write_file",
          "replace_in_file",
          "apply_patch",
          "delete_file",
          "create_document",
          "run_command",
          "exec_command",
          "write_stdin",
        ].includes(name) &&
        !(
          name === "run_command" &&
          (cacheableCommand(String((rawArguments as Record<string, unknown>)?.command ?? "")) ||
            readonlyCommand(String((rawArguments as Record<string, unknown>)?.command ?? "")))
        )
      )
        this.cache.clear();
      if (
        (context.session.parentSessionId ||
          context.session.executionMode === "docker" ||
          context.session.permissionMode === "request_approval") &&
        [
          "read_file",
          "read_document",
          "write_file",
          "replace_in_file",
          "apply_patch",
          "delete_file",
          "list_files",
          "search_files",
          "glob_files",
        ].includes(name)
      ) {
        return await this.executeDockerFile(name, rawArguments, context);
      }
      switch (name) {
        case "read_file":
        case "read_document":
          return await this.readFile(rawArguments, context);
        case "view_image":
          return await this.viewImage(rawArguments, context);
        case "create_document":
          return await this.createDocument(rawArguments, context);
        case "office_document":
          return await this.officeDocument(rawArguments, context);
        case "write_file":
          return await this.writeFile(rawArguments, context);
        case "replace_in_file":
          return await this.replaceInFile(rawArguments, context);
        case "apply_patch":
          return await this.applyPatch(rawArguments, context);
        case "delete_file":
          return await this.deleteFile(rawArguments, context);
        case "list_files":
          return await this.listFiles(rawArguments, context);
        case "search_files":
          return await this.searchFiles(rawArguments, context);
        case "glob_files":
          return await this.globFiles(rawArguments, context);
        case "web_fetch":
          return await this.webFetch(rawArguments, context);
        case "web_search":
          return await this.webSearch(rawArguments, context);
        case "lsp":
          lspSchema.parse(rawArguments);
          return {
            output: "LSP 工具由 Agent 运行时处理。",
            isError: true,
          };
        case "run_command":
          return await this.runCommand(rawArguments, context);
        case "exec_command":
          return await this.execCommand(rawArguments, context);
        case "write_stdin":
          return await this.writeStdin(rawArguments, context);
        default:
          return { output: `未知工具：${name}`, isError: true };
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const descriptor = TOOL_DESCRIPTORS.find((tool) => tool.name === name);
        const required = descriptor?.parameters.required;
        return {
          output: `TOOL_ARGUMENTS_INVALID: ${name}\n${error.message}\nRequired fields: ${Array.isArray(required) ? required.join(", ") : "see tool schema"}. Submit a JSON object matching this tool's schema and retry. The tool did not pass argument validation.`,
          isError: true,
        };
      }
      const captured =
        error &&
        typeof error === "object" &&
        "capturedOutput" in error &&
        typeof error.capturedOutput === "string"
          ? error.capturedOutput
          : undefined;
      const cleanupUnconfirmed =
        isNativeSandboxCleanupUnconfirmedError(error) ||
        isHostCommandCleanupUnconfirmedError(error);
      return {
        output: errorText(error),
        isError: true,
        ...(cleanupUnconfirmed ? { cleanupUnconfirmed: true } : {}),
        ...(captured ? { fullOutput: `${errorText(error)}\n${captured}` } : {}),
      };
    }
  }

  private async queryCodeIndex(
    raw: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = z
      .object({
        operation: z
          .enum(["symbols", "definitions", "references", "callers", "callees", "graph"])
          .optional(),
        query: z.string().max(500).optional(),
        path: z.string().max(32767).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        max_files: z.number().int().min(1).max(20000).optional(),
        max_depth: z.number().int().min(1).max(64).optional(),
      })
      .parse(raw);
    const root = context.session.workspacePath;
    if (!root) throw new Error("代码索引需要工作目录。");
    if (args.path && (isAbsolute(args.path) || args.path.split(/[\\/]/).includes("..")))
      throw new Error("代码索引只接受工作区内相对路径。");
    const approval = await this.approvePath(context, root, "read");
    if (!approval.allowed) return { output: approval.reason, isError: true };
    const isolated =
      context.session.permissionMode === "request_approval" ||
      context.session.executionMode === "docker";
    const native = context.session.executionMode !== "docker";
    const operation = async (request: {
      operation: "list" | "read";
      path: string;
      depth?: number;
      maxEntries?: number;
    }) =>
      native
        ? await this.nativeSandbox.fileOperation(
            root,
            request,
            context.signal,
            this.nativeScope(context),
          )
        : await new DockerService().fileOperation(
            context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
            root,
            request,
            context.signal,
          );
    const key = createHash("sha256")
      .update(
        `${resolve(root).toLowerCase()}:${context.session.permissionMode}:${context.session.executionMode}`,
      )
      .digest("hex");
    const output = await this.codeIndex.query(
      `${context.session.id}:${key}`,
      args,
      {
        load: () => context.indexStore?.load(key) ?? null,
        save: (snapshot) => context.indexStore?.save(key, snapshot),
        list: async () => {
          if (isolated) {
            const files = (await operation({
              operation: "list",
              path: ".",
              depth: args.max_depth ?? 32,
              maxEntries: Math.min(25000, (args.max_files ?? 10000) * 2),
            })) as Array<{
              path: string;
              directory: boolean;
              fingerprint?: string;
            }>;
            return files
              .filter((file) => !file.directory)
              .map((file) => ({
                path: file.path.replaceAll("\\", "/"),
                fingerprint: file.fingerprint ?? "",
              }));
          }
          const files = await walkFiles(
            root,
            args.max_depth ?? 32,
            Math.min(25000, (args.max_files ?? 10000) * 2),
          );
          const result: Array<{ path: string; fingerprint: string }> = [];
          for (const file of files) {
            if (file.directory || (await lstat(file.path)).isSymbolicLink()) continue;
            await safeFilePath(root, file.path);
            const metadata = await stat(file.path);
            result.push({
              path: relative(root, file.path).replaceAll("\\", "/"),
              fingerprint: `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`,
            });
          }
          return result;
        },
        read: async (path) => {
          const local = path.replaceAll("\\", "/");
          if (isAbsolute(local) || local.split("/").includes(".."))
            throw new Error("Indexed path outside workspace.");
          if (isolated) return String(await operation({ operation: "read", path: local }));
          return await readFile(await safeFilePath(root, local), "utf8");
        },
      },
      context.signal,
    );
    return { output, isError: false };
  }

  private async executeDockerFile(
    name: string,
    raw: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const root = context.session.workspacePath;
    const native = context.session.executionMode !== "docker";
    if (!root || (!native && !context.dockerImage))
      throw new Error("Isolated file environment is not ready.");
    const docker = new DockerService();
    const approvedWrites = new Set<string>();
    const approveWrite = async (target: string) => {
      if (approvedWrites.has(target)) return { allowed: true, reason: "" };
      const approval = await this.approvePath(context, target, "write");
      if (approval.allowed) approvedWrites.add(target);
      return approval;
    };
    const locate = (path: string | undefined) => {
      const value = path?.startsWith("/workspace/")
        ? path.slice(11)
        : path === "/workspace"
          ? "."
          : path;
      const target = resolveToolPath(value, root);
      const local = relative(root, target);
      if (local.startsWith("..") || isAbsolute(local))
        throw new Error("Docker 模式不允许访问挂载工作区以外的路径。");
      return { target, local: local.replaceAll("\\", "/") || "." };
    };
    const perform = async (
      operation: "read" | "write" | "delete" | "list",
      path: string,
      content?: string,
      depth?: number,
    ) =>
      native
        ? await this.nativeSandbox.fileOperation(
            root,
            {
              operation,
              path,
              ...(content !== undefined ? { content } : {}),
              ...(depth ? { depth } : {}),
            },
            context.signal,
            this.nativeScope(context),
          )
        : await docker.fileOperation(
            context.dockerImage as string,
            root,
            {
              operation,
              path,
              ...(content !== undefined ? { content } : {}),
              ...(depth ? { depth } : {}),
            },
            context.signal,
          );
    const change = async (
      path: string,
      after: string | null,
      mustExist = false,
    ): Promise<FileChange> => {
      const { target, local } = locate(path);
      const approval = await approveWrite(target);
      if (!approval.allowed) throw new Error(approval.reason);
      let before = "";
      let existed = true;
      try {
        before = String(await perform("read", local));
      } catch (error) {
        if (mustExist || !String(error).includes("FILE_NOT_FOUND")) throw error;
        existed = false;
      }
      await context.beforeFileWrite?.(
        target,
        existed ? createHash("sha256").update(before).digest("hex") : "missing",
      );
      await perform(after === null ? "delete" : "write", local, after ?? undefined);
      context.observeFile?.(
        target,
        after === null ? "missing" : createHash("sha256").update(after).digest("hex"),
      );
      const delta = createFileDiff(before, after ?? "");
      return {
        path: target,
        changeType: after === null ? "deleted" : existed ? "modified" : "created",
        additions: delta.additions,
        deletions: delta.deletions,
        ...(delta.diff ? { diff: delta.diff } : {}),
      };
    };
    if (name === "read_file" || name === "read_document") {
      const args = readFileSchema.parse(raw);
      const { target, local } = locate(args.path);
      const approval = await this.approvePath(context, target, "read");
      if (!approval.allowed) return { output: approval.reason, isError: true };
      if (isDocumentPath(target)) {
        const data = Buffer.from(
          String(
            native
              ? await this.nativeSandbox.fileOperation(
                  root,
                  { operation: "read_binary", path: local },
                  context.signal,
                  this.nativeScope(context),
                )
              : await docker.fileOperation(
                  context.dockerImage as string,
                  root,
                  { operation: "read_binary", path: local },
                  context.signal,
                ),
          ),
          "base64",
        );
        if (args.structure) return await this.documentStructure(data, target, args, context);
        const document = await extractDocumentBuffer(
          data,
          target,
          context.signal,
          args.render ? "vision" : "ocr",
        );
        context.observeFile?.(target, createHash("sha256").update(data).digest("hex"));
        return {
          output: `Path: ${target}\nFormat: ${document.format}\n${document.warnings.join("\n")}\n\n${hasReadRange(args) ? formatNumberedLines(document.text, args) : document.text}`,
          isError: false,
          ...(document.pageImages?.length
            ? {
                images: document.pageImages.map((page) => ({
                  dataUrl: page.dataUrl,
                  mimeType: "image/png",
                  alt: `PDF page ${page.page}`,
                })),
              }
            : {}),
        };
      }
      const text = await this.cache.deduplicate(
        `read-flight:${context.session.id}:${context.runId}:${context.contextEpoch}:${context.session.permissionMode}:${context.session.executionMode}:${target}`,
        async () => String(await perform("read", local)),
        context.signal,
      );
      if (text.includes("\0")) return { output: binaryReadMessage(target), isError: true };
      context.observeFile?.(target, createHash("sha256").update(text).digest("hex"));
      const key = contentCacheKey(
        `${context.session.id}:${context.runId}:${context.contextEpoch ?? ""}:${readRangeKey(args)}`,
        target,
        text,
      );
      const cached = args.refresh ? null : this.cache.get(key);
      if (cached !== null)
        return {
          output: `Cache hit: ${target} is unchanged (content hash verified). Reuse its previous file contents in this run; no new content to read.`,
          isError: false,
        };
      const output = formatNumberedLines(text, args);
      this.cache.put(key, output);
      return { output, isError: false };
    }
    if (name === "write_file") {
      const args = writeFileSchema.parse(raw);
      return {
        output: "File written in the isolated workspace.",
        isError: false,
        fileChange: await change(args.path, args.content),
      };
    }
    if (name === "delete_file") {
      const args = deleteFileSchema.parse(raw);
      return {
        output: "已在 Docker 中删除文件。",
        isError: false,
        fileChange: await change(args.path, null, true),
      };
    }
    if (name === "replace_in_file") {
      const args = replaceFileSchema.parse(raw);
      const { local, target } = locate(args.path);
      const approval = await approveWrite(target);
      if (!approval.allowed) return { output: approval.reason, isError: true };
      const before = String(await perform("read", local));
      if (
        before.indexOf(args.old_text) < 0 ||
        before.indexOf(args.old_text) !== before.lastIndexOf(args.old_text)
      )
        throw new Error("替换原文不存在或不唯一。");
      return {
        output: "已在 Docker 中更新文件。",
        isError: false,
        fileChange: await change(args.path, before.replace(args.old_text, args.new_text), true),
      };
    }
    if (name === "apply_patch") {
      const args = applyPatchSchema.parse(raw);
      const changes: FileChange[] = [];
      for (const block of parsePatchBlocks(args.patch)) {
        const { local, target } = locate(block.path);
        const approval = await approveWrite(target);
        if (!approval.allowed) return { output: approval.reason, isError: true };
        if (block.operation === "add") {
          try {
            await perform("read", local);
            throw new Error("新增目标已存在。");
          } catch (error) {
            if (!String(error).includes("FILE_NOT_FOUND")) throw error;
          }
        }
        const after =
          block.operation === "delete"
            ? null
            : block.operation === "add"
              ? block.body
                  .filter((line) => line.startsWith("+"))
                  .map((line) => line.slice(1))
                  .join("\n")
              : applyUpdatePatch(String(await perform("read", local)), block.body);
        changes.push(await change(block.path, after, block.operation !== "add"));
      }
      return {
        output: `已在 Docker 中应用 ${changes.length} 个文件变更。`,
        isError: false,
        fileChanges: changes,
      };
    }
    const args =
      name === "list_files"
        ? listFilesSchema.parse(raw ?? {})
        : name === "glob_files"
          ? globFilesSchema.parse(raw)
          : searchFilesSchema.parse(raw);
    const { target, local } = locate(args.path);
    const approval = await this.approvePath(context, target, "read");
    if (!approval.allowed) return { output: approval.reason, isError: true };
    const files = (await perform(
      "list",
      local,
      undefined,
      "depth" in args ? args.depth : 8,
    )) as Array<{ path: string; directory: boolean }>;
    if (name === "list_files")
      return {
        output: files.map((file) => `${file.directory ? "dir" : "file"} ${file.path}`).join("\n"),
        isError: false,
      };
    if (name === "glob_files") {
      const parsed = globFilesSchema.parse(raw);
      return {
        output: files
          .filter((file) => !file.directory && globExpression(parsed.pattern).test(file.path))
          .slice(0, parsed.max_results ?? 200)
          .map((file) => file.path)
          .join("\n"),
        isError: false,
      };
    }
    const parsed = searchFilesSchema.parse(raw);
    const matches: string[] = [];
    for (const file of files.filter((file) => !file.directory)) {
      if (matches.length >= (parsed.max_results ?? 80)) break;
      try {
        const text = String(await perform("read", file.path));
        text.split(/\r?\n/).forEach((line, index) => {
          if (
            line.toLowerCase().includes(parsed.query.toLowerCase()) &&
            matches.length < (parsed.max_results ?? 80)
          )
            matches.push(`${file.path}:${index + 1}: ${line}`);
        });
      } catch {
        /* Skip binary or oversized files. */
      }
    }
    return { output: matches.join("\n") || "没有匹配项。", isError: false };
  }

  private async readFile(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = readFileSchema.parse(rawArguments);
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "read");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    const metadata = await stat(target);
    if (!metadata.isFile())
      return {
        output: "READ_FILE_NOT_REGULAR: The path is a directory. Use list_files to inspect it.",
        isError: true,
      };
    if (isDocumentPath(target)) {
      if (metadata.size > MAX_DOCUMENT_BYTES) {
        return { output: "文档超过 25 MiB，拒绝直接提取。", isError: true };
      }
      const buffer = await readFile(target);
      if (args.structure) return await this.documentStructure(buffer, target, args, context);
      const document = await extractDocumentBuffer(
        buffer,
        target,
        context.signal,
        args.render ? "vision" : "ocr",
      );
      context.observeFile?.(target, createHash("sha256").update(buffer).digest("hex"));
      return {
        output: [
          `Path: ${target}`,
          `Format: ${document.format}`,
          ...(document.warnings.length > 0 ? [`Warnings: ${document.warnings.join("; ")}`] : []),
          "",
          hasReadRange(args)
            ? formatNumberedLines(document.text, args)
            : document.text.trim() || "(文档没有可提取文本)",
        ].join("\n"),
        isError: false,
        ...(document.pageImages?.length
          ? {
              images: document.pageImages.map((page) => ({
                dataUrl: page.dataUrl,
                mimeType: "image/png",
                alt: `PDF page ${page.page}`,
              })),
            }
          : {}),
      };
    }
    if (metadata.size > MAX_FILE_BYTES)
      return { output: "文件超过 2 MB，拒绝直接读取。", isError: true };
    const buffer = Buffer.from(
      await this.cache.deduplicate(
        `read-flight:${context.session.id}:${context.runId}:${context.contextEpoch}:${target}`,
        async () => (await readFile(target)).toString("base64"),
        context.signal,
      ),
      "base64",
    );
    context.observeFile?.(target, createHash("sha256").update(buffer).digest("hex"));
    if (buffer.length > MAX_FILE_BYTES) {
      return { output: "文件超过 2 MB，拒绝直接读取。", isError: true };
    }
    if (!isProbablyText(buffer)) {
      return { output: binaryReadMessage(target), isError: true };
    }
    const text = decodeText(buffer);
    const key = contentCacheKey(
      `${context.session.id}:${context.runId}:${context.contextEpoch ?? ""}:${readRangeKey(args)}`,
      target,
      text,
    );
    const cached = args.refresh ? null : this.cache.get(key);
    if (cached !== null)
      return {
        output: `Cache hit: ${target} is unchanged (content hash verified). Reuse its previous file contents in this run; no new content to read.`,
        isError: false,
      };
    const output = `Path: ${target}\n\n${formatNumberedLines(text, args)}`;
    this.cache.put(key, output);
    return { output, isError: false };
  }

  private async documentStructure(
    bytes: Buffer,
    target: string,
    args: z.infer<typeof readFileSchema>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (/\.(?:xlsx|pptx)$/i.test(target)) {
      const result = await executeOfficeDocument(
        { operation: "inspect", path: target },
        new Map([[target, bytes]]),
        context.signal,
      );
      context.observeFile?.(target, createHash("sha256").update(bytes).digest("hex"));
      return {
        output: `Path: ${target}\n${formatNumberedLines(result.output, args)}`,
        isError: false,
      };
    }
    if (!target.toLowerCase().endsWith(".docx"))
      throw new Error(
        "DOCUMENT_STRUCTURE_UNSUPPORTED: structure:true requires DOCX, XLSX or PPTX.",
      );
    const structure = await readDocxStructure(bytes);
    context.signal.throwIfAborted();
    context.observeFile?.(target, structure.sha256);
    return {
      output: `Path: ${target}\nFormat: DOCX structure\nSource SHA-256: ${structure.sha256}\n\n${formatNumberedLines(structure.text, args)}`,
      isError: false,
    };
  }

  private async viewImage(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = viewImageSchema.parse(rawArguments);
    const root = context.session.workspacePath;
    if (!root) throw new Error("view_image requires a workspace.");
    const target = await safeFilePath(root, resolveToolPath(args.path, root));
    const approval = await this.approvePath(context, target, "read");
    if (!approval.allowed) return { output: approval.reason, isError: true };
    const maxBytes = 20 * 1024 * 1024;
    const isolated =
      Boolean(context.session.parentSessionId) ||
      context.session.executionMode === "docker" ||
      context.session.permissionMode === "request_approval";
    let bytes: Buffer;
    if (isolated) {
      const request = { operation: "read_binary" as const, path: relative(root, target) };
      const base64 =
        context.session.executionMode === "docker"
          ? await new DockerService().fileOperation(
              context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
              root,
              request,
              context.signal,
            )
          : await this.nativeSandbox.fileOperation(
              root,
              request,
              context.signal,
              this.nativeScope(context),
            );
      if (typeof base64 !== "string" || base64.length > Math.ceil(maxBytes / 3) * 4)
        throw new Error("view_image exceeds the 20 MiB image limit.");
      bytes = Buffer.from(base64, "base64");
    } else {
      const metadata = await stat(target);
      if (!metadata.isFile()) throw new Error("view_image requires a regular image file.");
      if (metadata.size > maxBytes) throw new Error("view_image exceeds the 20 MiB image limit.");
      bytes = await readFile(target);
    }
    context.signal.throwIfAborted();
    if (bytes.length > maxBytes) throw new Error("view_image exceeds the 20 MiB image limit.");
    const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? "image/jpeg"
        : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
          ? "image/gif"
          : bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
              bytes.subarray(8, 12).toString("ascii") === "WEBP"
            ? "image/webp"
            : null;
    if (!mimeType) throw new Error("IMAGE_FORMAT_UNSUPPORTED: use a PNG, JPEG, WebP or GIF image.");
    context.observeFile?.(target, createHash("sha256").update(bytes).digest("hex"));
    return {
      output: `Path: ${target}\nImage: ${mimeType}, ${bytes.length} bytes.`,
      isError: false,
      images: [
        {
          dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
          mimeType,
          alt: basename(target),
        },
      ],
    };
  }

  private async officeDocument(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = officeDocumentSchema.parse(rawArguments);
    context.signal.throwIfAborted();
    if (context.session.agentMode !== "work")
      throw new Error("office_document 专精工具仅在 WorkAgent 中可用。");
    if (
      context.session.patchOnly &&
      ["create_spreadsheet", "edit_spreadsheet", "edit_presentation"].includes(args.operation)
    )
      throw new Error("Patch-only 会话不能创建或修改二进制 Office 文件。");
    const root = context.session.workspacePath;
    if (!root) throw new Error("Office 文档处理需要先选择工作目录。");

    const locate = async (path: string): Promise<string> => {
      if (/^(?:https?|data|blob|file):/i.test(path))
        throw new Error("Office 文档必须使用当前工作区文件路径。");
      const local =
        context.session.executionMode === "docker" && path.startsWith("/workspace/")
          ? path.slice(11)
          : path;
      return await safeFilePath(root, resolveToolPath(local, root));
    };
    const isolated =
      context.session.parentSessionId ||
      context.session.executionMode === "docker" ||
      context.session.permissionMode === "request_approval";
    const readBinary = async (path: string): Promise<Buffer> => {
      const absolute = await locate(path);
      const forceOfficeReadApproval =
        context.forceApproval ||
        (context.forceReadApprovalPaths?.has(resolve(absolute).toLowerCase()) ?? false);
      const approved = await this.approvePath(
        {
          ...context,
          toolName: "read_file",
          ...(forceOfficeReadApproval ? { forceApproval: true } : {}),
        },
        absolute,
        "read",
      );
      if (!approved.allowed) throw new Error(approved.reason);
      if (isolated) {
        const local = relative(root, absolute).replaceAll("\\", "/");
        if (context.session.executionMode === "docker") {
          const bytes = Buffer.from(
            String(
              await new DockerService().fileOperation(
                context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
                root,
                { operation: "read_binary", path: local },
                context.signal,
              ),
            ),
            "base64",
          );
          if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("Office 文件超过 25 MiB 限制。");
          context.observeFile?.(absolute, createHash("sha256").update(bytes).digest("hex"));
          return bytes;
        }
        const bytes = Buffer.from(
          String(
            await this.nativeSandbox.fileOperation(
              root,
              { operation: "read_binary", path: local },
              context.signal,
              this.nativeScope(context),
            ),
          ),
          "base64",
        );
        if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("Office 文件超过 25 MiB 限制。");
        context.observeFile?.(absolute, createHash("sha256").update(bytes).digest("hex"));
        return bytes;
      }
      const guarded = await readGuardedFile(
        root,
        relative(root, absolute).replaceAll("\\", "/"),
        MAX_DOCUMENT_BYTES,
        { signal: context.signal },
      );
      context.observeFile?.(absolute, guarded.sha256);
      return guarded.buffer;
    };
    const assets = new Map<string, Buffer>();
    for (const path of officeDocumentAssets(args)) {
      context.signal.throwIfAborted();
      const bytes = await readBinary(path);
      assets.set(path, bytes);
    }

    const outputPaths =
      args.operation === "verify"
        ? [args.output_path, args.render_path].filter((path): path is string => Boolean(path))
        : args.operation === "inspect"
          ? []
          : [args.path];
    const targets = new Map<string, { path: string; local: string; expectedHash: string }>();
    const hashTarget = async (path: string, local: string): Promise<string> => {
      if (isolated) {
        const request = { operation: "hash" as const, path: local };
        return String(
          context.session.executionMode === "docker"
            ? await new DockerService().fileOperation(
                context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
                root,
                request,
                context.signal,
              )
            : await this.nativeSandbox.fileOperation(
                root,
                request,
                context.signal,
                this.nativeScope(context),
              ),
        );
      }
      await locate(path);
      const metadata = await statGuardedPath(root, local, { signal: context.signal });
      if (metadata.state === "missing") return "missing";
      if (metadata.directory || metadata.size > MAX_DOCUMENT_BYTES)
        throw new Error("Office 输出目标必须是小于 25 MiB 的普通文件。");
      return (await readGuardedFile(root, local, MAX_DOCUMENT_BYTES, { signal: context.signal }))
        .sha256;
    };
    for (const path of outputPaths) {
      const absolute = await locate(path),
        local = relative(root, absolute).replaceAll("\\", "/");
      if (isMemoryPath(absolute))
        throw new Error("Project memory is broker-managed. Office tools cannot write it.");
      if (
        [...targets.values()].some((value) => value.path.toLowerCase() === absolute.toLowerCase())
      )
        throw new Error("Office 输出路径不能重复。");
      if (
        args.operation === "verify" &&
        absolute.toLowerCase() === (await locate(args.path)).toLowerCase()
      )
        throw new Error("验证输出必须另存，不能覆盖检查源文件。");
      const approval = await this.approvePath(
        {
          ...context,
          forceApproval: Boolean(
            context.forceApproval || context.forceWriteApprovalPaths?.has(absolute.toLowerCase()),
          ),
        },
        absolute,
        "write",
      );
      if (!approval.allowed) return { output: approval.reason, isError: true };
      const expectedHash = await hashTarget(absolute, local);
      if (expectedHash !== "missing" && !("overwrite" in args && args.overwrite))
        return {
          output: `输出文件已存在：${absolute}。请明确设置 overwrite:true。`,
          isError: true,
        };
      targets.set(path, { path: absolute, local, expectedHash });
    }

    const canUseOffice =
      context.session.agentMode === "work" &&
      context.session.permissionMode === "full_access" &&
      context.session.executionMode === "host" &&
      !context.session.parentSessionId;
    const result = await executeOfficeDocument(rawArguments, assets, context.signal, {
      canUseOffice,
    });
    const warnings = [...result.warnings];
    const fileChanges: FileChange[] = [];

    const save = async (path: string, bytes: Buffer) => {
      if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("生成 Office 文件超过 25 MiB 限制。");
      const target = targets.get(path);
      if (!target) throw new Error("Office 输出未经过路径和权限预检。");
      const { path: outputPath, local, expectedHash } = target;
      const existing = expectedHash !== "missing";
      await context.beforeFileWrite?.(outputPath, expectedHash);
      context.signal.throwIfAborted();
      context.onEffectStart?.();
      if (isolated) {
        if (context.session.executionMode === "docker") {
          await new DockerService().fileOperation(
            context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
            root,
            {
              operation: "write_binary",
              path: local,
              content: bytes.toString("base64"),
              expectedHash,
            },
            context.signal,
          );
        } else {
          await this.nativeSandbox.fileOperation(
            root,
            {
              operation: "write_binary",
              path: local,
              content: bytes.toString("base64"),
              expectedHash,
            },
            context.signal,
            this.nativeScope(context),
          );
        }
      } else {
        await writeGuardedFile(root, local, bytes, expectedHash, {
          signal: context.signal,
          createParents: true,
        });
      }
      context.observeFile?.(outputPath, createHash("sha256").update(bytes).digest("hex"));
      fileChanges.push({
        path: outputPath,
        changeType: existing ? "modified" : "created",
        additions: 0,
        deletions: 0,
      });
    };
    if (result.bytes) await save(args.path, result.bytes);
    if (result.rendition && args.operation === "verify" && args.render_path)
      await save(args.render_path, result.rendition.bytes);
    if (result.recalculatedBytes && args.operation === "verify" && args.output_path)
      await save(args.output_path, result.recalculatedBytes);
    return {
      output: [
        result.output,
        ...warnings.map((warning) => `WARNING: ${warning}`),
        ...fileChanges.map((change) => `已写入 ${change.path}。`),
      ].join("\n"),
      isError: Boolean(result.verification && result.verification.status !== "verified"),
      ...(result.verification ? { officeVerification: result.verification } : {}),
      ...(fileChanges.length === 1 && fileChanges[0] ? { fileChange: fileChanges[0] } : {}),
      ...(fileChanges.length ? { fileChanges } : {}),
    };
  }

  private async createDocument(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = createDocumentSchema.parse(rawArguments);
    context.signal.throwIfAborted();
    if (context.session.patchOnly) throw new Error("Patch-only 会话不能生成二进制文档。");
    const root = context.session.workspacePath;
    if (!root) throw new Error("制作文档需要先选择工作目录。");
    const locate = async (path: string) => {
      if (/^(?:https?|data|blob|file):/i.test(path))
        throw new Error("文档和图片必须使用当前工作区文件路径。");
      const local =
        context.session.executionMode === "docker" && path.startsWith("/workspace/")
          ? path.slice(11)
          : path;
      return await safeFilePath(root, resolveToolPath(local, root));
    };
    const target = await locate(args.path);
    const writeApproval = await this.approvePath(context, target, "write");
    if (!writeApproval.allowed) return { output: writeApproval.reason, isError: true };
    const isolated =
      context.session.parentSessionId ||
      context.session.executionMode === "docker" ||
      context.session.permissionMode === "request_approval";
    const localPath = relative(root, target).replaceAll("\\", "/");
    const gateway = async (request: {
      operation: "read_binary" | "write_binary" | "hash";
      path: string;
      content?: string;
      expectedHash?: string;
    }): Promise<unknown> => {
      if (context.session.executionMode === "docker") {
        return await new DockerService().fileOperation(
          context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
          root,
          request,
          context.signal,
        );
      }
      return await this.nativeSandbox.fileOperation(
        root,
        request,
        context.signal,
        this.nativeScope(context),
      );
    };
    const readBinary = async (path: string): Promise<Buffer> => {
      const approved = await this.approvePath(
        {
          ...context,
          toolName: "read_file",
          forceApproval: context.forceReadApprovalPaths?.has(resolve(path).toLowerCase()) ?? false,
        },
        path,
        "read",
      );
      if (!approved.allowed) throw new Error(approved.reason);
      const local = relative(root, path).replaceAll("\\", "/");
      if (isolated) {
        return Buffer.from(
          String(await gateway({ operation: "read_binary", path: local })),
          "base64",
        );
      }
      return (
        await readGuardedFile(root, local, MAX_AUTHORED_DOCUMENT_BYTES, { signal: context.signal })
      ).buffer;
    };
    const currentHash = async (): Promise<string> => {
      if (isolated) {
        return String(await gateway({ operation: "hash", path: localPath }));
      }
      await locate(args.path);
      const metadata = await statGuardedPath(root, localPath, { signal: context.signal });
      if (metadata.state === "missing") return "missing";
      if (metadata.directory) throw new Error("文档输出目标必须是普通文件。");
      if (metadata.size > MAX_AUTHORED_DOCUMENT_BYTES)
        throw new Error("已有文档超过 25 MiB，请选择新的输出路径。");
      return (
        await readGuardedFile(root, localPath, MAX_AUTHORED_DOCUMENT_BYTES, {
          signal: context.signal,
        })
      ).sha256;
    };
    const expectedHash = await currentHash();
    const existing = expectedHash !== "missing";
    if (existing && !args.overwrite) {
      return {
        output: `输出文件已存在：${target}。如需替换，请明确设置 overwrite:true。`,
        isError: true,
      };
    }

    const assets = new Map<string, Buffer>();
    let assetBytes = 0;
    for (const assetPath of documentAssetPaths(args)) {
      context.signal.throwIfAborted();
      const asset = await locate(assetPath);
      const bytes = await readBinary(asset);
      assetBytes += bytes.length;
      if (assetBytes > MAX_AUTHORING_IMAGE_BYTES) throw new Error("文档图片合计超过 20 MiB。");
      assets.set(assetPath, bytes);
    }
    context.signal.throwIfAborted();

    const extension = documentExtension(args);
    const source = args.template ?? args.edit;
    const templateBytes = source ? await readBinary(await locate(source.path)) : undefined;
    const content =
      extension === ".pdf"
        ? await printDocumentPdf(renderDocumentHtml(args, assets), args, context.signal)
        : await authorOfficeDocument(args, assets, context.signal, templateBytes);
    if (content.length > MAX_AUTHORED_DOCUMENT_BYTES) throw new Error("生成文档超过 25 MiB 限制。");
    context.signal.throwIfAborted();

    await context.beforeFileWrite?.(target, expectedHash);
    context.signal.throwIfAborted();
    context.onEffectStart?.();
    if (isolated) {
      await gateway({
        operation: "write_binary",
        path: localPath,
        content: content.toString("base64"),
        expectedHash,
      });
    } else {
      await writeGuardedFile(root, localPath, content, expectedHash, {
        signal: context.signal,
        createParents: true,
      });
    }
    context.observeFile?.(target, createHash("sha256").update(content).digest("hex"));
    return {
      output: `已生成 ${target}（${extension.slice(1).toUpperCase()}，${content.length} bytes）。`,
      isError: false,
      fileChange: {
        path: target,
        changeType: existing ? "modified" : "created",
        additions: 0,
        deletions: 0,
      },
    };
  }

  private async writeFile(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = writeFileSchema.parse(rawArguments);
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "write");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    let before = "";
    let existed = true;
    let version = "missing";
    try {
      const buffer = await readFile(target);
      before = editableText(buffer, target);
      version = createHash("sha256").update(buffer).digest("hex");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      existed = false;
    }
    await context.beforeFileWrite?.(target, version);
    await writeFile(target, args.content, "utf8");
    context.observeFile?.(target, createHash("sha256").update(args.content).digest("hex"));
    const delta = createFileDiff(before, args.content);
    return {
      output: `已写入 ${target}（${Buffer.byteLength(args.content, "utf8")} bytes）。`,
      isError: false,
      ...(delta.additions + delta.deletions > 0
        ? {
            fileChange: {
              path: target,
              changeType: existed ? "modified" : "created",
              additions: delta.additions,
              deletions: delta.deletions,
              ...(delta.diff ? { diff: delta.diff } : {}),
            } satisfies FileChange,
          }
        : {}),
    };
  }

  private async replaceInFile(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = replaceFileSchema.parse(rawArguments);
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "write");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    const buffer = await readFile(target);
    const current = editableText(buffer, target);
    await context.beforeFileWrite?.(target, createHash("sha256").update(buffer).digest("hex"));
    const first = current.indexOf(args.old_text);
    const last = current.lastIndexOf(args.old_text);
    if (first === -1) {
      return { output: "old_text 在文件中不存在。", isError: true };
    }
    if (first !== last) {
      return { output: "old_text 在文件中出现多次，请提供更精确的原文。", isError: true };
    }
    const next =
      current.slice(0, first) + args.new_text + current.slice(first + args.old_text.length);
    await writeFile(target, next, "utf8");
    context.observeFile?.(target, createHash("sha256").update(next).digest("hex"));
    const delta = createFileDiff(current, next);
    return {
      output: `已更新 ${target}。`,
      isError: false,
      ...(delta.additions + delta.deletions > 0
        ? {
            fileChange: {
              path: target,
              changeType: "modified",
              additions: delta.additions,
              deletions: delta.deletions,
              ...(delta.diff ? { diff: delta.diff } : {}),
            } satisfies FileChange,
          }
        : {}),
    };
  }

  private async deleteFile(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = deleteFileSchema.parse(rawArguments);
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "write");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    const metadata = await stat(target);
    if (!metadata.isFile()) {
      return { output: "delete_file 只允许删除单个文件。", isError: true };
    }
    const buffer = await readFile(target);
    const content = isProbablyText(buffer) ? decodeText(buffer) : "";
    await context.beforeFileWrite?.(target, createHash("sha256").update(buffer).digest("hex"));
    await rm(target);
    context.observeFile?.(target, "missing");
    const delta = createFileDiff(content, "");
    return {
      output: `已删除 ${target}。`,
      isError: false,
      fileChange: {
        path: target,
        changeType: "deleted",
        additions: 0,
        deletions: delta.deletions,
        ...(delta.diff ? { diff: delta.diff } : {}),
      },
    };
  }

  private async applyPatch(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = applyPatchSchema.parse(rawArguments);
    const blocks = parsePatchBlocks(args.patch);
    const changes: FileChange[] = [];

    for (const block of blocks) {
      const target = resolveToolPath(block.path, context.session.workspacePath);
      const approval = await this.approvePath(
        context,
        target,
        block.operation === "delete" ? "write" : "write",
      );
      if (!approval.allowed) {
        return { output: approval.reason, isError: true, fileChanges: changes };
      }

      let before = "";
      let existed = false;
      let version = "missing";
      try {
        const buffer = await readFile(target);
        before =
          block.operation === "delete"
            ? isProbablyText(buffer)
              ? decodeText(buffer)
              : ""
            : editableText(buffer, target);
        version = createHash("sha256").update(buffer).digest("hex");
        existed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        existed = false;
      }

      let after = "";
      await context.beforeFileWrite?.(target, version);
      if (block.operation === "delete") {
        if (!existed) {
          return { output: `要删除的文件不存在：${target}`, isError: true, fileChanges: changes };
        }
        await rm(target);
      } else if (block.operation === "add") {
        if (existed) {
          return { output: `要新增的文件已存在：${target}`, isError: true, fileChanges: changes };
        }
        after = block.body
          .filter((line) => line.startsWith("+"))
          .map((line) => line.slice(1))
          .join("\n");
        await writeFile(target, after, "utf8");
      } else {
        if (!existed) {
          return { output: `要修改的文件不存在：${target}`, isError: true, fileChanges: changes };
        }
        after = applyUpdatePatch(before, block.body);
        await writeFile(target, after, "utf8");
      }
      context.observeFile?.(
        target,
        block.operation === "delete" ? "missing" : createHash("sha256").update(after).digest("hex"),
      );

      const delta = createFileDiff(before, after);
      changes.push({
        path: target,
        changeType: block.operation === "delete" ? "deleted" : existed ? "modified" : "created",
        additions: delta.additions,
        deletions: delta.deletions,
        ...(delta.diff ? { diff: delta.diff } : {}),
      });
    }

    return {
      output: `已应用 ${changes.length} 个文件变更。`,
      isError: false,
      fileChanges: changes,
    };
  }

  private async listFiles(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = listFilesSchema.parse(rawArguments ?? {});
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "read");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    const files = await walkFiles(target, args.depth ?? 2);
    if (files.length === 0) {
      return { output: "目录为空。", isError: false };
    }
    const lines = files.map((item) => {
      const rel = relative(context.session.workspacePath ?? target, item.path);
      return `${item.directory ? "dir " : "file"}  ${rel || basename(item.path)}${item.directory ? "/" : ""}`;
    });
    return {
      output: `Path: ${target}\n\n${lines.join("\n")}${files.length >= MAX_LIST_ENTRIES ? "\n… listing truncated" : ""}`,
      isError: false,
    };
  }

  private async searchFiles(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = searchFilesSchema.parse(rawArguments);
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "read");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    const maxResults = args.max_results ?? 80;
    const files = await walkFiles(target, 8);
    const matches: string[] = [];
    const needle = args.query.toLocaleLowerCase("en-US");

    for (const item of files) {
      if (matches.length >= maxResults) {
        break;
      }
      if (item.directory || item.size > MAX_FILE_BYTES) {
        continue;
      }
      let content: string;
      try {
        const buffer = await readFile(item.path);
        if (!isProbablyText(buffer)) {
          continue;
        }
        content = decodeText(buffer);
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]?.toLocaleLowerCase("en-US").includes(needle)) {
          const rel = relative(context.session.workspacePath ?? target, item.path);
          matches.push(`${rel || item.path}:${index + 1}: ${lines[index]?.trim() ?? ""}`);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }
    }

    return {
      output: matches.length ? matches.join("\n") : `没有找到“${args.query}”的文本匹配。`,
      isError: false,
    };
  }

  private async globFiles(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = globFilesSchema.parse(rawArguments);
    const target = resolveToolPath(args.path, context.session.workspacePath);
    const approval = await this.approvePath(context, target, "read");
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }
    const matcher = globExpression(args.pattern);
    const files = await walkFiles(target, 12);
    const matches: Array<{ path: string; modifiedAt: number }> = [];
    for (const file of files) {
      if (file.directory) {
        continue;
      }
      const relativePath = relative(context.session.workspacePath ?? target, file.path).replaceAll(
        "\\",
        "/",
      );
      if (!matcher.test(relativePath)) {
        continue;
      }
      matches.push({ path: relativePath, modifiedAt: (await stat(file.path)).mtimeMs });
      if (matches.length >= (args.max_results ?? 200)) {
        break;
      }
    }
    matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
    return {
      output: matches.length
        ? matches.map((match) => match.path).join("\n")
        : `没有文件匹配 ${args.pattern}。`,
      isError: false,
    };
  }

  private async webFetch(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = webFetchSchema.parse(rawArguments);
    const url = new URL(args.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { output: "web_fetch 只支持 HTTP 或 HTTPS URL。", isError: true };
    }
    const approvedChatNetwork =
      context.session.agentMode === "chat" && context.session.chatNetworkEnabled !== false;
    if (context.session.permissionMode === "request_approval" && !approvedChatNetwork) {
      const request: ApprovalRequest = {
        id: randomUUID(),
        sessionId: context.session.id,
        runId: context.runId,
        toolCallId: context.toolCallId,
        toolName: context.toolName,
        summary: `读取网页 ${url.hostname}`,
        detail: url.toString(),
        pathScope: `web:${url.origin}`,
        commandPrefix: null,
        risk: "normal",
        createdAt: new Date().toISOString(),
      };
      const decision = await context.requestApproval(request, context.signal);
      context.permissions.remember(context.session.id, request, decision);
      if (decision.decision === "deny") {
        return {
          output: decision.feedback ? `用户拒绝：${decision.feedback}` : "用户拒绝了网页读取。",
          isError: true,
        };
      }
    }
    const budget = createWebRequestBudget(context.signal);
    try {
      const response = await awaitWithSignal(
        publicFetch(url, {
          signal: budget.signal,
          headers: {
            "User-Agent": `Mingshen-Harness/${APP_VERSION}`,
            Accept: "text/html,application/xhtml+xml,text/plain,application/json",
          },
        }),
        budget.signal,
      );
      const body = await awaitWithSignal(response.text(), budget.signal);
      const content = readableHtml(body).slice(0, args.max_chars ?? 80_000);
      return {
        output: `URL: ${url.toString()}\nStatus: ${response.status}\n\n${content || "(empty response)"}`,
        isError: !response.ok,
      };
    } catch (error) {
      return {
        output: webRequestFailure(error, "网页读取", context.signal, budget.timedOut),
        isError: true,
      };
    } finally {
      budget.dispose();
    }
  }

  private async webSearch(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = webSearchSchema.parse(rawArguments);
    const limit = args.max_results ?? 8;
    const budget = createWebRequestBudget(context.signal);
    const fetchWithBudget = (url: string | URL, init: RequestInit = {}) =>
      awaitWithSignal(publicFetch(url, { ...init, signal: budget.signal }), budget.signal);

    try {
      const searchBody = new URLSearchParams({ q: args.query }).toString();
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      let duckDuckGoFailure: unknown;

      try {
        const ddg = await fetchWithBudget("https://html.duckduckgo.com/html/", {
          method: "POST",
          body: searchBody,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": String(Buffer.byteLength(searchBody)),
            "User-Agent": `Mingshen-Harness/${APP_VERSION}`,
          },
        });
        if (!ddg.ok) throw new Error(`DuckDuckGo returned HTTP ${ddg.status}.`);
        const html = await awaitWithSignal(ddg.text(), budget.signal);
        const pattern =
          /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi;
        for (const match of html.matchAll(pattern)) {
          const rawUrl = match[1] ?? "";
          const target = rawUrl.startsWith("//duckduckgo.com/l/?uddg=")
            ? decodeURIComponent(rawUrl.split("uddg=")[1]?.split("&")[0] ?? "")
            : rawUrl;
          results.push({
            title: decodeHtml(match[2] ?? ""),
            url: target,
            snippet: decodeHtml(match[3] ?? match[4] ?? ""),
          });
          if (results.length >= limit) break;
        }
      } catch (error) {
        if (context.signal.aborted || budget.timedOut.aborted) throw error;
        duckDuckGoFailure = error;
      }

      if (results.length === 0) {
        try {
          const rss = await fetchWithBudget(
            `https://www.bing.com/search?format=rss&q=${encodeURIComponent(args.query)}`,
            {
              headers: {
                Accept: "application/rss+xml,application/xml,text/xml",
                "User-Agent": `Mingshen-Harness/${APP_VERSION}`,
              },
            },
          );
          if (!rss.ok) throw new Error(`Bing returned HTTP ${rss.status}.`);
          const xml = await awaitWithSignal(rss.text(), budget.signal);
          for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
            const body = item[1] ?? "";
            results.push({
              title: decodeHtml(/<title>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? ""),
              url: /<link>([\s\S]*?)<\/link>/i.exec(body)?.[1]?.trim() ?? "",
              snippet: decodeHtml(/<description>([\s\S]*?)<\/description>/i.exec(body)?.[1] ?? ""),
            });
            if (results.length >= limit) break;
          }
        } catch (error) {
          if (context.signal.aborted || budget.timedOut.aborted) throw error;
          if (duckDuckGoFailure) {
            throw new Error(
              `DuckDuckGo failed: ${errorText(duckDuckGoFailure)}; Bing failed: ${errorText(error)}`,
            );
          }
          throw error;
        }
      }
      return {
        output:
          results.length > 0
            ? results
                .map(
                  (result, index) =>
                    `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`,
                )
                .join("\n\n")
            : `没有找到“${args.query}”的搜索结果。`,
        isError: false,
      };
    } catch (error) {
      return {
        output: webRequestFailure(error, "网页搜索", context.signal, budget.timedOut),
        isError: true,
      };
    } finally {
      budget.dispose();
    }
  }

  private commandSecurityScope(context: ToolExecutionContext): string {
    return JSON.stringify([
      context.session.workspacePath,
      context.session.parentSessionId,
      context.session.permissionMode,
      context.session.executionMode,
      context.dockerImage ?? null,
    ]);
  }

  private async execCommand(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = execCommandSchema.parse(rawArguments);
    const blocked = isDangerousCommand(args.command) || documentWorkaroundMessage(args.command);
    if (blocked) return { output: blocked, isError: true };
    const requestedCwd =
      context.session.executionMode === "docker" && args.cwd?.startsWith("/workspace")
        ? args.cwd === "/workspace"
          ? "."
          : args.cwd.startsWith("/workspace/")
            ? args.cwd.slice(11)
            : args.cwd
        : args.cwd;
    const cwd = resolveToolPath(requestedCwd, context.session.workspacePath);
    const approval = await this.approveCommand(context, args.command, cwd);
    if (!approval.allowed) return { output: approval.reason, isError: true };
    context.signal.throwIfAborted();
    const launch = await this.preparePersistentCommand(args.command, cwd, context);
    context.signal.throwIfAborted();
    context.onEffectStart?.();
    const snapshot = await this.commands.start(
      { sessionId: context.session.id, runId: context.runId },
      { command: args.command, cwd, securityScope: this.commandSecurityScope(context) },
      launch,
      {
        signal: context.signal,
        timeoutMs: args.timeout_ms ?? 30 * 60_000,
        yieldMs: args.yield_time_ms ?? 1000,
        maxOutputChars: args.max_output_chars ?? 20_000,
      },
    );
    return {
      output: snapshot.output,
      ...(snapshot.fullOutput ? { fullOutput: snapshot.fullOutput } : {}),
      isError: snapshot.isError,
      commandSession: {
        id: snapshot.id,
        running: snapshot.running,
        unreadOutputChars: snapshot.unreadOutputChars,
      },
    };
  }

  private async writeStdin(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = writeStdinSchema.parse(rawArguments);
    const owner = { sessionId: context.session.id, runId: context.runId };
    const existing = this.commands.inspect(args.session_id, owner);
    if (existing.securityScope !== this.commandSecurityScope(context)) {
      await this.commands.interact(args.session_id, owner, {
        terminate: true,
        yieldMs: 0,
        maxOutputChars: 100,
      });
      throw new Error(
        "COMMAND_SCOPE_CHANGED: permissions or execution environment changed; start a new command.",
      );
    }
    const terminate = args.terminate || args.chars === "\u0003";
    const chars = terminate ? "" : args.chars;
    if (chars) {
      const blocked = isDangerousCommand(chars) || documentWorkaroundMessage(chars);
      if (blocked) return { output: blocked, isError: true };
    }
    if (
      (chars || args.close_stdin) &&
      (context.session.permissionMode === "request_approval" || context.forceApproval)
    ) {
      const decision = await context.requestApproval(
        {
          id: randomUUID(),
          sessionId: context.session.id,
          runId: context.runId,
          toolCallId: context.toolCallId,
          toolName: context.toolName,
          summary: "Send input to a running command?",
          detail: `Command: ${existing.command}\nWorking directory: ${existing.cwd}\nInput:\n${chars || ""}${args.close_stdin ? "\n[close stdin]" : ""}`,
          pathScope: null,
          commandPrefix: null,
          ...(context.forceApproval ? { manualOnly: true } : {}),
          risk: "elevated",
          createdAt: new Date().toISOString(),
        },
        context.signal,
      );
      if (decision.decision === "deny")
        return { output: decision.feedback || "Command input denied.", isError: true };
    }
    context.signal.throwIfAborted();
    if (existing.securityScope !== this.commandSecurityScope(context)) {
      await this.commands.interact(args.session_id, owner, {
        terminate: true,
        yieldMs: 0,
        maxOutputChars: 100,
      });
      throw new Error(
        "COMMAND_SCOPE_CHANGED: permissions changed while waiting for input approval.",
      );
    }
    if (chars || args.close_stdin || terminate) context.onEffectStart?.();
    const snapshot = await this.commands.interact(args.session_id, owner, {
      ...(chars ? { chars } : {}),
      ...(args.close_stdin ? { closeStdin: true } : {}),
      ...(terminate ? { terminate: true } : {}),
      yieldMs: args.yield_time_ms ?? 1000,
      maxOutputChars: args.max_output_chars ?? 20_000,
    });
    return {
      output: snapshot.output,
      ...(snapshot.fullOutput ? { fullOutput: snapshot.fullOutput } : {}),
      isError: snapshot.isError,
      commandSession: {
        id: snapshot.id,
        running: snapshot.running,
        unreadOutputChars: snapshot.unreadOutputChars,
      },
    };
  }

  private async preparePersistentCommand(
    command: string,
    cwd: string,
    context: ToolExecutionContext,
  ): Promise<CommandLaunch> {
    const root = context.session.workspacePath;
    if (
      (context.session.parentSessionId || context.session.permissionMode === "request_approval") &&
      context.session.executionMode !== "docker"
    ) {
      if (!root)
        throw new Error("Protected commands require a workspace. Host fallback is disabled.");
      return await this.nativeSandbox.prepareCommand(root, command, context.signal, {
        cwd,
        ...(context.session.parentSessionId
          ? { readOnly: true, readOnlyPaths: await existingMemoryPaths(root) }
          : {}),
      });
    }
    const bootstrap =
      "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;$ErrorActionPreference='Stop';$global:LASTEXITCODE=0;";
    const useDocker = context.session.executionMode === "docker";
    if (!useDocker) {
      return {
        executable: WINDOWS_POWERSHELL,
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-OutputFormat",
          "Text",
          "-EncodedCommand",
          Buffer.from(
            `${bootstrap}${command}\n;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`,
            "utf16le",
          ).toString("base64"),
        ],
        cwd,
      };
    }
    const dockerWorkspace = resolve(root || cwd);
    const localCwd = relative(dockerWorkspace, cwd);
    if (
      localCwd === ".." ||
      localCwd.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(localCwd)
    )
      throw new Error("Docker command directory must be inside the workspace.");
    const memoryPaths =
      context.session.parentSessionId && root ? await existingMemoryPaths(root) : [];
    const containerName = `mingshen-command-${randomUUID()}`;
    return {
      executable: dockerExecutable(),
      args: [
        "run",
        "--name",
        containerName,
        "--rm",
        "-i",
        ...DOCKER_SECURITY_ARGS,
        ...(context.session.permissionMode === "request_approval" ? ["--network=none"] : []),
        "--mount",
        `type=bind,source=${dockerWorkspace},target=/workspace${context.session.parentSessionId ? ",readonly" : ""}`,
        ...memoryPaths.flatMap((directory) => [
          "--mount",
          `type=bind,source=${directory},target=/workspace/${basename(directory)},readonly`,
        ]),
        "-w",
        `/workspace/${localCwd.replaceAll("\\", "/")}`,
        "--entrypoint",
        "pwsh",
        context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-OutputFormat",
        "Text",
        "-EncodedCommand",
        Buffer.from(
          `${bootstrap}${command.replaceAll(dockerWorkspace, "/workspace")}\n;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`,
          "utf16le",
        ).toString("base64"),
      ],
      cwd: process.cwd(),
      cleanup: () =>
        new Promise<void>((resolveCleanup, rejectCleanup) => {
          execFile(
            dockerExecutable(),
            ["rm", "-f", containerName],
            { windowsHide: true, timeout: 15_000 },
            (error, _stdout, stderr) => {
              if (error && !String(stderr).includes("No such container"))
                rejectCleanup(
                  new Error(
                    `CONTAINER_CLEANUP_UNCONFIRMED: ${containerName}: ${String(stderr || error.message)}`,
                  ),
                );
              else resolveCleanup();
            },
          );
        }),
    };
  }

  private async runCommand(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const args = runCommandSchema.parse(rawArguments);
    const dangerous = isDangerousCommand(args.command);
    if (dangerous) {
      return { output: dangerous, isError: true };
    }
    const documentWorkaround = documentWorkaroundMessage(args.command);
    if (documentWorkaround) {
      return { output: documentWorkaround, isError: true };
    }

    const requestedCwd =
      context.session.executionMode === "docker" && args.cwd?.startsWith("/workspace")
        ? args.cwd === "/workspace"
          ? "."
          : args.cwd.startsWith("/workspace/")
            ? args.cwd.slice(11)
            : args.cwd
        : args.cwd;
    const cwd = resolveToolPath(requestedCwd, context.session.workspacePath);
    const approval = await this.approveCommand(context, args.command, cwd);
    if (!approval.allowed) {
      return { output: approval.reason, isError: true };
    }

    const commandKey = cacheableCommand(args.command)
      ? `command:${context.session.id}:${context.runId}:${context.contextEpoch}:${context.session.permissionMode}:${context.session.executionMode}:${context.dockerImage}:${cwd}:${args.command}:${process.env.PATH}`
      : null;
    const cachedCommand = commandKey ? this.cache.get(commandKey) : null;
    if (cachedCommand !== null)
      return { output: `[cached runtime probe]\n${cachedCommand}`, isError: false };
    const readCommand = readonlyCommand(args.command);
    if (readCommand && context.session.workspacePath) {
      const path = resolve(cwd, readCommand.path);
      const root = context.session.workspacePath;
      const rel = relative(root, path);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("..\\"))
        return { output: "Read-only command dependency is outside the workspace.", isError: true };
      const isolated =
        context.session.permissionMode === "request_approval" ||
        context.session.executionMode === "docker";
      const read = async () => {
        if (isolated) {
          const request = {
            operation:
              readCommand.operation === "read"
                ? ("read" as const)
                : readCommand.operation === "exists"
                  ? ("exists" as const)
                  : ("list" as const),
            path: rel || ".",
            depth: 1,
          };
          return context.session.executionMode === "docker"
            ? await new DockerService().fileOperation(
                context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
                root,
                request,
                context.signal,
              )
            : await this.nativeSandbox.fileOperation(
                root,
                request,
                context.signal,
                this.nativeScope(context),
              );
        }
        if (readCommand.operation === "read") {
          const { buffer } = await readGuardedFile(root, rel, MAX_DOCUMENT_BYTES, {
            signal: context.signal,
          });
          if (!isProbablyText(buffer)) throw new Error(binaryReadMessage(path));
          return decodeText(buffer);
        }
        const metadata = await statGuardedPath(root, rel, { signal: context.signal });
        if (readCommand.operation === "exists") return metadata.state !== "missing";
        if (metadata.state === "missing") throw new Error("FILE_NOT_FOUND");
        if (!metadata.directory) return [{ name: basename(path), directory: false }];
        return await listGuardedDirectory(root, rel, { signal: context.signal }).then((items) =>
          items
            .map((item) => ({ name: item.name, directory: item.directory }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      };
      const depKey = `dependency:${context.session.id}:${context.runId}:${context.contextEpoch}:${context.session.permissionMode}:${context.session.executionMode}:${context.dockerImage}:${path}:${readCommand.operation}`;
      let dependency: unknown;
      try {
        dependency = await this.cache
          .deduplicate(depKey, async () => JSON.stringify(await read()), context.signal)
          .then((value) => JSON.parse(value) as unknown);
      } catch (error) {
        if (
          String(error).includes("FILE_NOT_FOUND") ||
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          if (readCommand.operation === "exists")
            return { output: "exit_code: 0\nFalse", isError: false };
        }
        throw error;
      }
      const text =
        readCommand.operation === "exists"
          ? dependency
            ? "True"
            : "False"
          : typeof dependency === "string"
            ? dependency
            : readCommand.nameOnly && Array.isArray(dependency)
              ? dependency
                  .map((item) =>
                    typeof item === "object" && item ? (item.name ?? item.path) : item,
                  )
                  .join("\n")
              : JSON.stringify(dependency, null, 2);
      const key = contentCacheKey(depKey, args.command, text),
        cached = this.cache.get(key);
      const output = `exit_code: 0\n${truncate(text)}`;
      this.cache.put(key, output, 15000);
      return {
        output: cached ? `[cached read-only command; dependencies verified]\n${cached}` : output,
        ...(text.length > MAX_TOOL_OUTPUT ? { fullOutput: `exit_code: 0\n${text}` } : {}),
        isError: false,
      };
    }
    if (
      (context.session.parentSessionId || context.session.permissionMode === "request_approval") &&
      context.session.executionMode !== "docker"
    ) {
      if (!context.session.workspacePath)
        return {
          output: "Protected commands require a workspace. Host fallback is disabled.",
          isError: true,
        };
      context.onEffectStart?.();
      const result = await this.nativeSandbox.run(
        context.session.workspacePath,
        args.command,
        context.signal,
        {
          cwd,
          timeoutMs: args.timeout_ms ?? DEFAULT_COMMAND_TIMEOUT,
          scope: this.nativeScope(context),
          ...(context.session.parentSessionId
            ? {
                // MXC cannot protect a memory directory before it exists.
                readOnly: true,
                readOnlyPaths: await existingMemoryPaths(context.session.workspacePath),
              }
            : {}),
        },
      );
      const output = `exit_code: ${result.exitCode}\n${truncate(result.output)}`;
      if (commandKey && result.exitCode === 0) this.cache.put(commandKey, output, 15_000);
      return {
        output,
        ...(result.output.length > MAX_TOOL_OUTPUT
          ? { fullOutput: `exit_code: ${result.exitCode}\n${result.output}` }
          : {}),
        isError: result.exitCode !== 0,
      };
    }

    if (context.session.executionMode !== "docker") {
      context.onEffectStart?.();
      const result = await this.hostCommands.run({
        sessionId: context.session.id,
        runId: context.runId,
        toolCallId: context.toolCallId,
        executable: WINDOWS_POWERSHELL,
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-OutputFormat",
          "Text",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;${args.command}`,
        ],
        cwd,
        signal: context.signal,
        timeoutMs: args.timeout_ms ?? DEFAULT_COMMAND_TIMEOUT,
      });
      const text = result.output.trim();
      if (commandKey && !result.isError) this.cache.put(commandKey, truncate(text), 15_000);
      return {
        output: truncate(text),
        ...(result.capturedOutput.length > MAX_TOOL_OUTPUT
          ? { fullOutput: result.capturedOutput }
          : {}),
        isError: result.isError,
        ...(result.cleanupUnconfirmed ? { cleanupUnconfirmed: true } : {}),
      };
    }

    const protectedMemoryDirectories =
      context.session.parentSessionId &&
      context.session.executionMode === "docker" &&
      context.session.workspacePath
        ? await existingMemoryPaths(context.session.workspacePath)
        : [];
    return await new Promise<ToolExecutionResult>((resolveResult) => {
      const useDocker = context.session.executionMode === "docker";
      const dockerWorkspace = context.session.workspacePath
        ? resolve(context.session.workspacePath)
        : cwd;
      const command = useDocker
        ? args.command.replaceAll(dockerWorkspace, "/workspace")
        : args.command;
      const localCwd = relative(dockerWorkspace, cwd);
      if (useDocker && (localCwd.startsWith("..") || isAbsolute(localCwd))) {
        resolveResult({ output: "Docker 命令目录必须位于挂载工作区内。", isError: true });
        return;
      }
      const executable = useDocker ? dockerExecutable() : WINDOWS_POWERSHELL;
      const containerName = `mingshen-command-${randomUUID()}`;
      let cleanupFailure = "";
      const cleanupContainer = (): Promise<void> => {
        if (!useDocker) return Promise.resolve();
        return new Promise((done) =>
          execFile(
            dockerExecutable(),
            ["rm", "-f", containerName],
            { windowsHide: true, timeout: 15_000 },
            (error, _stdout, stderr) => {
              if (error && !String(stderr).includes("No such container"))
                cleanupFailure = `CONTAINER_CLEANUP_UNCONFIRMED: ${containerName}: ${String(stderr || error.message)}. Verify the container has stopped before new writes.`;
              done();
            },
          ),
        );
      };
      const spawnArgs = useDocker
        ? [
            "run",
            "--name",
            containerName,
            "--rm",
            ...DOCKER_SECURITY_ARGS,
            ...(context.session.permissionMode === "request_approval" ? ["--network=none"] : []),
            "--mount",
            `type=bind,source=${dockerWorkspace},target=/workspace${context.session.parentSessionId ? ",readonly" : ""}`,
            ...protectedMemoryDirectories.flatMap((directory) => [
              "--mount",
              `type=bind,source=${directory},target=/workspace/${basename(directory)},readonly`,
            ]),
            "-w",
            `/workspace/${localCwd.replaceAll("\\", "/")}`,
            "--entrypoint",
            "pwsh",
            context.dockerImage ?? "mcr.microsoft.com/powershell:lts-alpine",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-OutputFormat",
            "Text",
            "-Command",
            command,
          ]
        : [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-OutputFormat",
            "Text",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;${command}`,
          ];
      context.onEffectStart?.();
      const child = spawn(executable, spawnArgs, {
        cwd: useDocker ? process.cwd() : cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const captured = new BoundedOutput();
      let finished = false;
      let terminating: Promise<void> | null = null;
      let terminatedResult: ToolExecutionResult | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (result: ToolExecutionResult) => {
        if (finished) {
          return;
        }
        finished = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        context.signal.removeEventListener("abort", onAbort);
        if (commandKey && !result.isError)
          this.cache.put(commandKey, truncate(result.output), 15_000);
        resolveResult({
          output: truncate(result.output),
          ...(captured.text().length > MAX_TOOL_OUTPUT
            ? {
                fullOutput: `${result.isError ? "Command failed or was interrupted.\n" : ""}${captured.text()}`,
              }
            : {}),
          isError: result.isError,
        });
      };

      const terminate = (result: ToolExecutionResult) => {
        if (terminating || finished) return;
        terminatedResult = result;
        terminating = killProcessTree(child);
        // Keep the execution and its writer lease alive until process close, even after cancellation.
      };
      timeout = setTimeout(() => {
        terminate({
          output: `命令超时（${args.timeout_ms ?? DEFAULT_COMMAND_TIMEOUT} ms）。\n${stdout}\n${stderr}`,
          isError: true,
        });
      }, args.timeout_ms ?? DEFAULT_COMMAND_TIMEOUT);

      const onAbort = () => {
        terminate({
          output: "命令已取消。执行中断前可能已产生部分修改，请核实真实状态。",
          isError: true,
        });
      };
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        captured.append(chunk);
        stdout = (stdout + chunk).slice(-MAX_TOOL_OUTPUT);
      });
      child.stderr?.on("data", (chunk: string) => {
        captured.append(chunk);
        stderr = (stderr + chunk).slice(-MAX_TOOL_OUTPUT);
      });
      child.on("error", (error) => {
        finish({ output: error.message, isError: true });
      });
      child.on("close", async (code) => {
        if (terminating && terminatedResult) {
          const result = terminatedResult;
          await terminating;
          await cleanupContainer();
          finish({
            ...result,
            output: cleanupFailure ? `${cleanupFailure}\n${result.output}` : result.output,
          });
          return;
        }
        const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        finish({
          output: `exit_code: ${code ?? "null"}\n${combined || "(no output)"}`,
          isError: (code ?? 1) !== 0,
        });
      });
    });
  }

  private async approvePath(
    context: ToolExecutionContext,
    path: string,
    access: "read" | "write",
  ): Promise<{ allowed: boolean; reason: string }> {
    if (context.session.permissionMode === "request_approval" && context.session.workspacePath) {
      try {
        if (resolve(path).toLowerCase() !== resolve(context.session.workspacePath).toLowerCase())
          await safeFilePath(context.session.workspacePath, path);
      } catch (error) {
        return { allowed: false, reason: `Protected path: ${errorText(error)}` };
      }
    }
    if (context.session.permissionMode === "full_access" && !context.forceApproval) {
      return { allowed: true, reason: "" };
    }
    if (!context.forceApproval && context.permissions.hasPath(context.session.id, path, access)) {
      return { allowed: true, reason: "" };
    }

    const request: ApprovalRequest = {
      id: randomUUID(),
      sessionId: context.session.id,
      runId: context.runId,
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      summary: `${access === "write" ? "写入" : "读取"} ${relativeForDisplay(path, context.session.workspacePath)}`,
      detail: path,
      pathScope: path,
      commandPrefix: null,
      ...(context.forceApproval ? { manualOnly: true } : {}),
      risk: access === "write" ? "elevated" : "normal",
      createdAt: new Date().toISOString(),
    };
    const decision = await context.requestApproval(request, context.signal);
    context.permissions.remember(context.session.id, request, decision);
    if (decision.decision === "deny") {
      return {
        allowed: false,
        reason: decision.feedback ? `用户拒绝：${decision.feedback}` : "用户拒绝了该操作。",
      };
    }
    return { allowed: true, reason: "" };
  }

  private async approveCommand(
    context: ToolExecutionContext,
    command: string,
    cwd: string,
  ): Promise<{ allowed: boolean; reason: string }> {
    if (context.session.permissionMode === "full_access") {
      return { allowed: true, reason: "" };
    }
    if (!context.forceApproval && context.permissions.hasCommand(context.session.id, command)) {
      return { allowed: true, reason: "" };
    }

    const request: ApprovalRequest = {
      id: randomUUID(),
      sessionId: context.session.id,
      runId: context.runId,
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      summary: `在 ${relativeForDisplay(cwd, context.session.workspacePath)} 运行命令`,
      detail: command,
      pathScope: null,
      commandPrefix: command,
      commandCwd: cwd,
      ...(context.forceApproval ? { manualOnly: true } : {}),
      risk: "elevated",
      createdAt: new Date().toISOString(),
    };
    const decision = await context.requestApproval(request, context.signal);
    context.permissions.remember(context.session.id, request, decision);
    if (decision.decision === "deny") {
      return {
        allowed: false,
        reason: decision.feedback ? `用户拒绝：${decision.feedback}` : "用户拒绝了该命令。",
      };
    }
    return { allowed: true, reason: "" };
  }
}
