import { describe, expect, it } from "vitest";
import {
  BUILTIN_TOOL_ENVELOPE_SCHEMA,
  ToolOutcomeService,
  validateBuiltinToolEnvelope,
  validateJsonSchemaValue,
} from "./tool-outcome-service";

describe("ToolOutcomeService", () => {
  it("rejects a built-in file result with invalid change invariants", async () => {
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: "written",
        isError: false,
        fileChange: {
          path: "",
          changeType: "modified",
          additions: -1,
          deletions: 0,
        },
      },
      {
        source: "builtin",
        toolName: "write_file",
        mayHaveSideEffect: true,
        effect: "confirmed",
      },
    );

    expect(outcome).toMatchObject({
      isError: true,
      status: "failed",
      effect: "uncertain",
      outcome: {
        validation: { status: "invalid", source: "builtin" },
      },
    });
    expect(outcome.outcome).toMatchObject({
      output: "written",
      isError: true,
      status: "failed",
      effect: "uncertain",
      validation: { status: "invalid", source: "builtin" },
    });
    expect(outcome.codes).toContain("INVALID_TOOL_ENVELOPE");
  });

  it("keeps a running command partial rather than claiming final success", async () => {
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: "server listening",
        isError: false,
        commandSession: {
          id: "12345678-1234-4234-8234-123456789abc",
          running: true,
          unreadOutputChars: 17,
        },
      },
      {
        source: "builtin",
        toolName: "exec_command",
        mayHaveSideEffect: true,
        effect: "confirmed",
      },
    );

    expect(outcome).toMatchObject({
      isError: false,
      status: "partial",
      effect: "confirmed",
      outcome: { validation: { status: "validated", source: "builtin" } },
    });
  });

  it("covers every field in the built-in execution envelope", async () => {
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: "office and command output",
        fullOutput: "complete office and command output",
        isError: false,
        cleanupUnconfirmed: false,
        officeVerification: {
          status: "verified",
          render: "verified",
          recalculation: "verified",
        },
        fileChange: {
          path: "report.docx",
          changeType: "modified",
          additions: 1,
          deletions: 1,
          diff: {
            lines: [
              { type: "removed", oldLine: 1, newLine: null, text: "old" },
              { type: "added", oldLine: null, newLine: 1, text: "new" },
            ],
            truncated: false,
          },
        },
        fileChanges: [
          {
            path: "report.docx",
            changeType: "modified",
            additions: 1,
            deletions: 1,
          },
        ],
        images: [
          {
            dataUrl: "data:image/png;base64,AA==",
            mimeType: "image/png",
            alt: "rendered page",
          },
        ],
        commandSession: {
          id: "12345678-1234-4234-8234-123456789abc",
          running: true,
          unreadOutputChars: 12,
        },
      },
      {
        source: "builtin",
        toolName: "office_document",
        mayHaveSideEffect: true,
        effect: "confirmed",
      },
    );

    expect(outcome).toMatchObject({
      isError: false,
      status: "partial",
      effect: "confirmed",
      validation: { status: "validated", source: "builtin" },
      outcome: { validation: { status: "validated", source: "builtin" } },
    });
    expect(outcome.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool-envelope" }),
        expect.objectContaining({ kind: "recovery" }),
      ]),
    );
  });

  it("accepts shared non-cyclic object references in a built-in result", async () => {
    const change = {
      path: "report.xlsx",
      changeType: "modified" as const,
      additions: 1,
      deletions: 0,
    };
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: "workbook written",
        isError: false,
        fileChange: change,
        fileChanges: [change],
      },
      {
        source: "builtin",
        toolName: "office_document",
        mayHaveSideEffect: true,
        effect: "confirmed",
      },
    );

    expect(outcome).toMatchObject({
      isError: false,
      status: "success",
      effect: "confirmed",
      validation: { status: "validated", source: "builtin" },
    });
    expect(outcome.codes).not.toContain("INVALID_TOOL_ENVELOPE");
  });

  it("rejects mismatched image data URLs and accepts reported artifact digests as evidence", async () => {
    const digest = "a".repeat(64);
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: "image",
        isError: false,
        artifactHash: digest,
        images: [
          {
            dataUrl: "data:image/png;base64,AA==",
            mimeType: "image/jpeg",
          },
        ],
      },
      {
        source: "builtin",
        toolName: "view_image",
        mayHaveSideEffect: false,
      },
    );

    expect(outcome.isError).toBe(true);
    expect(outcome.status).toBe("failed");
    expect(outcome.validation.status).toBe("invalid");
    expect(outcome.evidence).toContainEqual(
      expect.objectContaining({ kind: "artifact-hash", digest }),
    );
  });

  it("turns missing declared structured output into a failed, unverified-effect result", async () => {
    const outcome = await new ToolOutcomeService().normalize(
      { output: "legacy text", isError: false },
      {
        source: "mcp",
        toolName: "write_record",
        schema: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
          additionalProperties: false,
        },
        mayHaveSideEffect: true,
        effect: "confirmed",
      },
    );

    expect(outcome).toMatchObject({
      isError: true,
      status: "failed",
      effect: "uncertain",
      validation: { status: "invalid", source: "mcp" },
    });
    expect(outcome.codes).toContain("INVALID_OUTPUT");
  });

  it("does not settle a mutating call when declared-output validation is unavailable", async () => {
    const service = new ToolOutcomeService(async () => {
      throw new Error("schema worker unavailable");
    });
    const outcome = await service.normalize(
      { output: JSON.stringify({ id: "record-1" }), isError: false },
      {
        source: "mcp",
        toolName: "write_record",
        schema: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        structuredContent: { id: "record-1" },
        mayHaveSideEffect: true,
        effect: "confirmed",
      },
    );

    expect(outcome).toMatchObject({
      isError: true,
      status: "unverified",
      effect: "uncertain",
      validation: { status: "unverified", source: "mcp" },
    });
    expect(outcome.codes).toContain("OUTPUT_VALIDATION_UNAVAILABLE");
  });

  it("rejects recursive schemas without entering the worker", async () => {
    const schema: Record<string, unknown> = { type: "object" };
    schema.self = schema;
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: JSON.stringify({ value: 1 }),
        isError: false,
      },
      {
        source: "custom",
        toolName: "recursive",
        schema,
        structuredContent: { value: 1 },
        mayHaveSideEffect: false,
      },
    );

    expect(outcome).toMatchObject({
      isError: true,
      status: "failed",
      validation: { status: "invalid", source: "custom" },
    });
  });

  it("blocks remote and external schema references before dispatching a worker", async () => {
    const remote = await validateJsonSchemaValue(
      {
        type: "object",
        properties: {
          value: { $ref: "https://example.invalid/schema.json#/$defs/value" },
        },
      },
      { value: 1 },
    );
    const localExternal = await validateJsonSchemaValue(
      {
        type: "object",
        properties: {
          value: { $ref: "other-schema.json#/$defs/value" },
        },
      },
      { value: 1 },
    );

    expect(remote).toMatchObject({
      valid: false,
      error: "Remote or external JSON Schema references are not allowed.",
    });
    expect(localExternal).toEqual(remote);
  });

  it("rejects oversized schemas and external values before worker dispatch", async () => {
    const oversizedSchema = await validateJsonSchemaValue(
      {
        type: "object",
        description: "x".repeat(64 * 1024 + 1),
      },
      {},
    );
    const oversizedValue = await validateJsonSchemaValue(
      { type: "object" },
      { value: "x".repeat(2 * 1024 * 1024 + 1) },
    );

    expect(oversizedSchema).toEqual({
      valid: false,
      error: "Output schema is not valid bounded JSON.",
    });
    expect(oversizedValue).toEqual({
      valid: false,
      error: "Structured output exceeds 2097152 bytes.",
    });
  });

  it("rejects cyclic structured output instead of cloning it into a worker", async () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    const outcome = await new ToolOutcomeService().normalize(
      { output: "cycle", isError: false },
      {
        source: "custom",
        toolName: "cyclic",
        schema: { type: "object" },
        structuredContent: value,
        mayHaveSideEffect: false,
      },
    );

    expect(outcome).toMatchObject({
      isError: true,
      status: "failed",
      effect: "none",
      validation: { status: "invalid", source: "custom" },
    });
  });

  it("keeps normalized outcomes to the fixed contract without copying tool payloads", async () => {
    const normalized = await new ToolOutcomeService().normalize(
      {
        output: "rendered",
        isError: false,
        fileChanges: [],
        images: [
          {
            dataUrl: "data:image/png;base64,AA==",
            mimeType: "image/png",
          },
        ],
        structuredContent: { largeBusinessPayload: "x".repeat(100_000) },
      },
      {
        source: "builtin",
        toolName: "view_image",
        structuredContent: { largeBusinessPayload: "x".repeat(100_000) },
        mayHaveSideEffect: false,
      },
    );

    expect(normalized).not.toHaveProperty("fileChanges");
    expect(normalized).not.toHaveProperty("images");
    expect(normalized).not.toHaveProperty("structuredContent");
    expect(normalized.outcome).not.toHaveProperty("fileChanges");
    expect(normalized.outcome).not.toHaveProperty("images");
    expect(normalized.outcome).not.toHaveProperty("structuredContent");
    expect(Object.keys(normalized.outcome).sort()).toEqual([
      "codes",
      "effect",
      "evidence",
      "isError",
      "output",
      "retryable",
      "status",
      "validation",
    ]);
  });

  it("allows legacy text tools without declaring structural validation", async () => {
    const outcome = await new ToolOutcomeService().normalize(
      { output: "legacy text result", isError: false },
      {
        source: "mcp",
        toolName: "legacy_tool",
        mayHaveSideEffect: false,
      },
    );

    expect(outcome).toMatchObject({
      isError: false,
      status: "success",
      effect: "none",
      validation: { status: "not_declared", source: "mcp" },
    });
    expect(outcome.codes).toEqual([]);
  });

  it("keeps a failed write uncertain when execution had side-effect potential", async () => {
    const outcome = await new ToolOutcomeService().normalize(
      {
        output: "command failed after it may have changed external state",
        isError: true,
      },
      {
        source: "builtin",
        toolName: "write_stdin",
        mayHaveSideEffect: true,
      },
    );

    expect(outcome).toMatchObject({
      isError: true,
      status: "failed",
      effect: "uncertain",
      validation: { status: "validated", source: "builtin" },
    });
    expect(outcome.codes).toContain("SIDE_EFFECT_UNCERTAIN");
  });

  it("exports a fixed bounded built-in schema and rejects its complexity ceiling", async () => {
    expect(BUILTIN_TOOL_ENVELOPE_SCHEMA).toMatchObject({
      type: "object",
      properties: {
        fileChanges: { maxItems: 1_000 },
        images: { maxItems: 30 },
      },
    });
    const checked = await validateBuiltinToolEnvelope({
      output: "too many changes",
      isError: false,
      fileChanges: Array.from({ length: 1_001 }, (_, index) => ({
        path: `file-${index}.txt`,
        changeType: "modified",
        additions: 0,
        deletions: 0,
      })),
    });
    expect(checked.valid).toBe(false);
    expect(checked.error).toContain("must NOT have more than 1000 items");
  });

  it("reuses the bounded validation pool for concurrent built-in envelopes", async () => {
    const service = new ToolOutcomeService();
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        service.normalize(
          { output: `result-${index}`, isError: false },
          {
            source: "builtin",
            toolName: "read_file",
            mayHaveSideEffect: false,
          },
        ),
      ),
    );

    expect(outcomes.every((item) => item.validation.status === "validated")).toBe(true);
  });
});
