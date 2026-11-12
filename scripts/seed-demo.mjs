import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.argv[2];
if (!databasePath) {
  throw new Error("Usage: node scripts/seed-demo.mjs <path-to-mingshen.db>");
}

const database = new DatabaseSync(databasePath);
database.exec("pragma foreign_keys = on;");

const providerId = randomUUID();
const modelConfigId = randomUUID();
const sessionId = randomUUID();
const secondSessionId = randomUUID();
const now = new Date().toISOString();

database.exec("begin;");
try {
  database
    .prepare(
      `insert into providers (
        id, name, base_url, protocol, auth_mode, custom_header_name,
        active_key_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, null, null, ?, ?)`,
    )
    .run(
      providerId,
      "8sToken",
      "https://8stoken.com/v1",
      "openai_responses",
      "bearer",
      now,
      now,
    );

  database
    .prepare(
      `insert into models (
        id, provider_id, model_id, display_name, context_window, max_output_tokens,
        input_modalities, output_modalities, tool_calls, parallel_tool_calls,
        reasoning_levels, anthropic_none_behavior, enabled, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'disabled', 1, ?, ?)`,
    )
    .run(
      modelConfigId,
      providerId,
      "gpt-6.1-sol",
      "GPT-6.1 Sol",
      200_000,
      32_000,
      JSON.stringify(["text", "image"]),
      JSON.stringify(["text"]),
      JSON.stringify(["none", "low", "medium", "high", "xhigh", "max"]),
      now,
      now,
    );

  database
    .prepare(
      `insert into sessions (
        id, title, provider_id, model_id, workspace_path, system_prompt,
        reasoning_level, permission_mode, status, archived, pinned,
        created_at, updated_at, last_opened_at
      ) values (?, ?, ?, ?, ?, '', 'high', 'request_approval', 'idle', 0, 1, ?, ?, ?)`,
    )
    .run(
      sessionId,
      "实现模型连接与工具调用",
      providerId,
      modelConfigId,
      process.cwd(),
      now,
      now,
      now,
    );

  database
    .prepare(
      `insert into sessions (
        id, title, provider_id, model_id, workspace_path, system_prompt,
        reasoning_level, permission_mode, status, archived, pinned,
        created_at, updated_at, last_opened_at
      ) values (?, ?, ?, ?, ?, '', 'medium', 'request_approval', 'idle', 0, 0, ?, ?, ?)`,
    )
    .run(
      secondSessionId,
      "审查 Git 变更",
      providerId,
      modelConfigId,
      process.cwd(),
      now,
      now,
      now,
    );

  const addMessage = database.prepare(
    `insert into messages (id, session_id, seq, role, parts_json, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  );
  addMessage.run(
    randomUUID(),
    sessionId,
    1,
    "user",
    JSON.stringify([
      {
        type: "text",
        text: "检查项目当前状态，说明下一步应该先实现什么，并读取 src/main/index.ts。",
      },
    ]),
    now,
  );
  addMessage.run(
    randomUUID(),
    sessionId,
    2,
    "assistant",
    JSON.stringify([
      {
        type: "text",
        text: "我先读取入口文件和当前目录结构，再给出下一步建议。",
      },
      {
        type: "tool_call",
        callId: "call_demo_read",
        name: "read_file",
        arguments: "{\"path\":\"apps/desktop/src/main/index.ts\"}",
        status: "completed",
      },
    ]),
    now,
  );
  addMessage.run(
    randomUUID(),
    sessionId,
    3,
    "tool",
    JSON.stringify([
      {
        type: "tool_result",
        callId: "call_demo_read",
        output:
          "   1 | import { join, resolve } from \"node:path\";\n   2 | import { app, BrowserWindow, dialog, ipcMain } from \"electron\";",
        isError: false,
      },
    ]),
    now,
  );

  database.exec("commit;");
} catch (error) {
  database.exec("rollback;");
  throw error;
} finally {
  database.close();
}

console.log(JSON.stringify({ providerId, modelConfigId, sessionId, secondSessionId }, null, 2));
