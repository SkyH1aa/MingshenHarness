import http from "node:http";

const port = Number(process.env.MSH_MOCK_PORT ?? 43123);

function sseEvent(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (request.method === "GET" && url.pathname === "/v1/models") {
    sendJson(response, 200, { data: [{ id: "mock-tool-model" }] });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/responses") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        sendJson(response, 400, { error: { message: "invalid json" } });
        return;
      }

      if (payload.stream !== true) {
        sendJson(response, 200, {
          output: [{ content: [{ type: "output_text", text: "OK" }] }],
          usage: { input_tokens: 5, output_tokens: 1 },
        });
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const instruction = JSON.stringify(payload.instructions ?? "");
      const input = JSON.stringify(payload.input ?? []);
      const isTitle = instruction.includes("会话标题生成");
      const inputItems = Array.isArray(payload.input) ? payload.input : [];
      const lastUserIndex = inputItems.findLastIndex(
        (item) => item && typeof item === "object" && item.role === "user",
      );
      const currentTurn = lastUserIndex >= 0 ? inputItems.slice(lastUserIndex) : inputItems;
      const hasToolOutput = currentTurn.some((item) => item?.type === "function_call_output");
      const isDiffDemo = JSON.stringify(inputItems[lastUserIndex]?.content ?? "").includes(
        "DIFF_DEMO",
      );
      const isMcpTest = JSON.stringify(inputItems[lastUserIndex]?.content ?? "").includes("MCP_E2E");

      if (isTitle) {
        sseEvent(response, { type: "response.created" });
        sseEvent(response, { type: "response.output_text.delta", delta: "Mock 工具调用验证" });
        sseEvent(response, {
          type: "response.completed",
          response: { usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } },
        });
        response.end();
        return;
      }

      if (isMcpTest) {
        sseEvent(response, { type: "response.created" });
        if (!hasToolOutput) {
          const tool = (payload.tools ?? []).find((entry) => entry.name === "mcp__wikipedia__search");
          if (tool) {
            sseEvent(response, { type: "response.output_item.added", output_index: 0, item: { type: "function_call", call_id: "call_mcp_e2e", name: tool.name, arguments: "" } });
            sseEvent(response, { type: "response.function_call_arguments.delta", output_index: 0, delta: JSON.stringify({ query: "TypeScript" }) });
          } else sseEvent(response, { type: "response.output_text.delta", delta: "MCP_E2E_FAILED: Wikipedia tool was not exposed." });
        } else {
          const output = currentTurn.find((item) => item?.type === "function_call_output")?.output ?? "";
          sseEvent(response, { type: "response.output_text.delta", delta: `MCP_E2E_RESULT: ${String(output).slice(0, 500)}` });
        }
        sseEvent(response, { type: "response.completed", response: { usage: { input_tokens: 30, output_tokens: 20, total_tokens: 50 } } });
        response.end(); return;
      }

      if (isDiffDemo && !hasToolOutput) {
        sseEvent(response, { type: "response.created" });
        sseEvent(response, {
          type: "response.output_text.delta",
          delta: "我会创建一个演示文件，并实时报告修改内容。",
        });
        sseEvent(response, {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_mock_diff",
            name: "write_file",
            arguments: "",
          },
        });
        const argumentsText = JSON.stringify({
          path: "diff-demo.ts",
          content: [
            `// generated at ${new Date().toISOString()}`,
            "export interface DemoState {",
            "  name: string;",
            "  enabled: boolean;",
            "}",
            "",
            "export const initialState: DemoState = {",
            '  name: "Mingshen",',
            "  enabled: true,",
            "};",
          ].join("\n"),
        });
        const chunks = argumentsText.match(/.{1,36}/gs) ?? [];
        let chunkIndex = 0;
        const timer = setInterval(() => {
          const chunk = chunks[chunkIndex];
          if (chunk) {
            sseEvent(response, {
              type: "response.function_call_arguments.delta",
              output_index: 0,
              delta: chunk,
            });
            chunkIndex += 1;
            return;
          }
          clearInterval(timer);
          sseEvent(response, {
            type: "response.completed",
            response: { usage: { input_tokens: 80, output_tokens: 22, total_tokens: 102 } },
          });
          response.end();
        }, 600);
        return;
      }

      if (!hasToolOutput) {
        sseEvent(response, { type: "response.created" });
        sseEvent(response, {
          type: "response.output_text.delta",
          delta: isDiffDemo
            ? "我会创建一个演示文件，并实时报告修改内容。"
            : "我先读取项目文档，确认当前 Harness 的能力边界。",
        });
        sseEvent(response, {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            call_id: isDiffDemo ? "call_mock_diff" : "call_mock_read",
            name: isDiffDemo ? "write_file" : "read_file",
            arguments: "",
          },
        });
        sseEvent(response, {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: JSON.stringify(
            isDiffDemo
              ? {
                  path: "diff-demo.ts",
                  content: [
                    "export interface DemoState {",
                    "  name: string;",
                    "  enabled: boolean;",
                    "}",
                    "",
                    "export const initialState: DemoState = {",
                    '  name: "Mingshen",',
                    "  enabled: true,",
                    "};",
                  ].join("\n"),
                }
              : { path: "PRODUCT.md" },
          ),
        });
        sseEvent(response, {
          type: "response.completed",
          response: { usage: { input_tokens: 80, output_tokens: 22, total_tokens: 102 } },
        });
        response.end();
        return;
      }

      sseEvent(response, { type: "response.created" });
      const finish = () => {
        sseEvent(response, {
          type: "response.output_text.delta",
          delta: isDiffDemo
            ? "已创建 `diff-demo.ts`，并完成类型结构、默认值和导出内容的写入。"
            : "已读取 PRODUCT.md。当前 Harness 已具备本地会话、三协议流式适配、模型配置、文件工具和审批闭环。下一步应补上工作区保存校验、增量 diff 和 Windows 沙箱。",
        });
        sseEvent(response, {
          type: "response.completed",
          response: { usage: { input_tokens: 160, output_tokens: 44, total_tokens: 204 } },
        });
        response.end();
      };
      if (isDiffDemo) {
        setTimeout(finish, 15000);
      } else {
        finish();
      }
    });
    return;
  }

  sendJson(response, 404, { error: { message: "not found" } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock provider listening on http://127.0.0.1:${port}/v1`);
});
