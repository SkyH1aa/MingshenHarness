# Mingshen Harness 开发者接口

适用版本：1.3.7 · Windows 10/11 x64

本文说明本机 `/v1` API、随包 JavaScript SDK、CLI 和 ACP bridge。接口用于连接已经运行的 Mingshen Harness 桌面或托盘进程，不会启动独立后台服务，也不提供公网托管。

> 文档只描述已实现接口和兼容边界。实际随包 SDK/CLI 已与 Headless/Runtime 临时 SQLite 完成 loopback 联测，但该专项使用 `admitTurn` 合约桩，不覆盖真实模型/chat loop、全部桌面表面或第三方 ACP 编辑器。不要据本文推断真实付费供应商、正式安装包或全部编辑器集成都已通过。

## 安全边界

- 服务只允许监听 `127.0.0.1`，默认端口为 `4096`。
- 除 `/global/health` 等明确标注为公开的旧健康检查外，接口使用随机 Bearer Token。
- Token 随本地服务启动生成，服务重启后轮换。客户端必须从 **设置 → 运行与集成** 重新取得当前 Token。
- 不要转发 Token、端口或会话内容到公网，也不要在日志、脚本仓库或截图里保存真实 Token。
- `developer.api` 能力受管理策略控制。被拒绝时返回策略错误；准确运行停止仍是清理通道，不受普通开发者派发权限阻断。
- 接口不新增任意本地路径读取。文件、Office 和扩展操作仍通过桌面宿主已有的工作区、Profile、审批、隔离和写入租约。
- 请求正文上限为 2 MiB。附件和模型上下文还有各自更小的业务限制。

## 能力发现

调用 `GET /v1/capabilities`，先根据返回的能力布尔值决定是否使用扩展接口：

```json
{
  "version": "1.3.7",
  "apiVersion": "v1",
  "runtimeEvents": true,
  "eventReplay": true,
  "idempotentTurns": true,
  "exactRunCancellation": true,
  "policy": true,
  "taskClaims": true,
  "officeReceipts": true,
  "eventRetentionDays": 30,
  "eventRetentionBytes": 268435456,
  "limits": {
    "requestBodyBytes": 2097152,
    "eventPageSize": 2000
  },
  "permissionModes": ["request_approval", "full_access"]
}
```

字段表示宿主是否接入了相应处理器。返回 `false` 时，对应扩展路由不可用。即使返回 `true`，实际调用仍须满足当前管理策略、会话权限和执行环境。

## `/v1` 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/capabilities` | 读取版本、限制和能力开关 |
| `GET` | `/v1/events` | 回放并订阅持久运行事件 |
| `GET` | `/v1/sessions/{id}/snapshot` | 读取会话、消息、任务、运行、接纳记录和最新游标 |
| `POST` | `/v1/sessions/{id}/turns` | 幂等接纳并发送一轮请求 |
| `GET` | `/v1/runs/{runId}` | 读取准确运行状态 |
| `POST` | `/v1/runs/{runId}/cancel` | 请求停止准确运行 |
| `GET` | `/v1/policy/effective` | 读取不含秘密的有效策略 |
| `GET` / `POST` | `/v1/tasks/claims` | 查询、认领、续租、结算或人工恢复计划步骤 |
| `GET` / `POST` | `/v1/office/receipts` | 查询、准备或检查宿主办公交付回执 |

任务认领 `GET` 可按 `claimId`、`ownerRunId` 或 `sessionId` 查询，`includeTerminal=true` 可查看终态历史；`POST` 的 `action` 为 `claim`、`heartbeat`、`settle` 或 `recover`。`claim` 原子绑定计划步骤、generation、真实 `runId` 和授权执行者；`heartbeat` 只续租匹配的非终态运行；直接 `settle` 只接受 `completed` 或 `released`，`stale` 或 `cancel_requested` 必须使用 `recover`。办公回执 `GET` 按 `sessionId` 或 `deliveryId` 查询；外部 `POST` 仅接受 `prepare` 或 `check`。`prepare` 只接受会话工作区内的相对路径，宿主会拒绝穿越、绝对路径和符号链接逃逸；外部 `visual-batch`/`record-visual` 返回 `403 OFFICE_EXTERNAL_VISUAL_EVIDENCE_UNTRUSTED`，不能伪造宿主视觉验证。

两类写接口都受当前管理策略、有效权限、会话归属和运行所有权检查；能力返回 `false` 或处理器未注册时按 `503` 处理，不能把 HTTP 成功当作绕过宿主计划或 Office 服务的许可。

### 发送一轮请求

```http
POST /v1/sessions/{sessionId}/turns
Authorization: Bearer <token>
Idempotency-Key: 7d4688f8-6f2c-4c34-bd53-5f5c7c1f8e55
Content-Type: application/json

{
  "text": "检查当前项目并运行测试",
  "temporaryInstruction": "本轮只读",
  "attachments": []
}
```

`text` 必须包含非空文字。兼容字段 `parts` 可用于传文本部件，`attachments` 和 `temporaryInstruction` 继续通过宿主原有验证。响应通常为 `202`：

```json
{
  "runId": "c949fece-6e12-4a34-84b8-c2f1fc680fb6",
  "run": {
    "runId": "c949fece-6e12-4a34-84b8-c2f1fc680fb6",
    "sessionId": "session-id",
    "status": "accepted",
    "source": "chat"
  }
}
```

幂等规则：

- 同一会话、同一 `Idempotency-Key`、同一请求载荷返回原运行。
- 同一键搭配变化后的正文、附件或临时指令返回 `409 IDEMPOTENCY_CONFLICT`。
- 不同会话可以独立使用相同字符串，但推荐全局唯一键，减少客户端误用。
- 不要在一次逻辑请求的不同内容上复用键。
- 客户端超时后先用原键重试相同请求，再查询返回的 `runId`；不要直接创建第二个运行。

### 事件续接

```http
GET /v1/events?after=128&sessionId=<sessionId>
Authorization: Bearer <token>
Accept: text/event-stream
```

SSE 帧包含持久 `id` 和 `event: runtime`，`data` 为运行信封：

```text
id: 129
event: runtime
data: {"eventId":129,"seq":14,"sessionId":"session-id","runId":"run-id","type":"run_started","event":{"type":"run_started","sessionId":"session-id","runId":"run-id"},"createdAt":"2026-11-27T00:00:00.000Z"}
```

重连可发送：

```http
Last-Event-ID: 129
```

存在 `Last-Event-ID` 时优先使用该值。游标过期返回：

```json
{
  "error": "The requested event cursor has expired; fetch a new session snapshot.",
  "code": "CURSOR_EXPIRED",
  "snapshotRequired": true,
  "requestedCursor": 12,
  "earliestCursor": 184
}
```

此时调用会话快照，并使用返回的 `eventCursor` 继续。Token 增量、思考增量等临时事件可能没有持久 `eventId`。实时 SSE 中的 `assistant_delta`、`reasoning_delta` 没有 `id:`，也不会推进持久事件游标；客户端应实时展示它们，但仍以最后一个带 `id:` 的持久事件作为重连游标。最终助手消息、工具结果和会话快照才是权威内容，不要把临时增量的到达位置当作可回放检查点。

### 会话快照

`GET /v1/sessions/{id}/snapshot` 返回：

- `session`
- `messages`
- `todos`
- `runs`
- 最近请求接纳记录
- `eventCursor`
- `cursorExpired`
- `capabilities`

快照是恢复边界。客户端应从快照渲染历史，再只消费游标之后的事件，避免重复展示旧事件。

### 运行与停止

`GET /v1/runs/{runId}` 返回准确运行。终态为：

- `completed`
- `failed`
- `interrupted`
- `blocked_policy`

`POST /v1/runs/{runId}/cancel` 只请求停止该运行：

```json
{
  "accepted": true,
  "alreadyTerminal": false,
  "stopRequested": true,
  "cancellationConfirmed": false,
  "run": {}
}
```

`accepted: true` 和 `stopRequested: true` 只表示停止请求已接纳，不保证外部命令、远程 MCP 或 Office 进程已经立即终止。`cancellationConfirmed: false` 表示必须以准确 `runId` 的运行查询、停止事件或事件终态确认结果。终态运行返回 `alreadyTerminal: true`，不能把停止操作应用到同会话后续新运行。

新请求的运行行、幂等接纳记录和 `runtime.status` `accepted` 生命周期事件在同一数据库事务中写入，提交后才通过本地事件源发布。客户端若在提交后立即断线，仍可通过快照或 `GET /v1/events` 以新游标读取该接纳事件；重复幂等请求返回原运行，不重复生成接纳事件。

### 策略、认领和回执

- `GET /v1/policy/effective` 只返回非秘密的有效策略、来源状态和 revision。`status.machine`/`status.user` 分别给出层状态与该层 revision，机器层还包含策略文件路径；`capabilityDecisionsByLayer` 可核对每个能力在两层的原始决策，顶层 `capabilities` 是拒绝优先合并后的有效决策。项目或 Agent 不能借此放宽策略。
- 机器策略存在但无效时会暂停新的模型、工具、扩展、Office 验证和开发者派发，但不会阻断带有有效 Bearer Token 的诊断读取。现有会话历史读取、`GET /v1/sessions/{id}/snapshot`、`GET /v1/runs/{runId}` 和 `GET /v1/policy/effective` 仍可用于定位损坏或不可读的策略；这些 GET 不授予执行、写操作、认领或 Office 检查权限。
- `GET /v1/tasks/claims` 返回计划认领；`POST` 使用 `claim`、`heartbeat`、`settle` 或 `recover`。认领必须绑定现有 generation、步骤、真实执行者和有效运行；过期 generation、重复活动认领或所有者不匹配必须明确失败，不能静默覆盖当前所有者。
- `GET /v1/office/receipts` 返回宿主已有回执；外部 `POST` 只使用 `prepare` 或 `check`。两者经 ChatService 的宿主 Office 闭包执行，只允许未归档主 CodeAgent/WorkAgent + `host` + `full_access` 且有工作区的会话，并在每个阶段重新检查会话模式、管理策略、`file.read`/`office.verify`、最低交付状态、`requiredRender`/`requiredVisual` 和其他强制检查。
- `prepare` 的 `path` 和可选 `sourcePath` 必须是会话工作区内相对路径；宿主在访问前解析真实路径并拒绝工作区外目标。回执与最终文件哈希绑定，文件变化后应返回 `stale`，不能继续显示为已验证。
- 外部 `visual-batch` 或 `record-visual` 返回 `403 OFFICE_EXTERNAL_VISUAL_EVIDENCE_UNTRUSTED` 和 `hostVerified:false`。外部客户端不能提交图片、页码或“已验证”声明冒充宿主证据；它应调用 `check`，让 MingshenHarness 从自己的受控渲染和视觉模型预算生成证据。桌面任务工作台仍可通过内部宿主路径继续未完成的视觉批次，不改变外部 API 信任边界。
- 写操作成功不自动等于计划步骤完成或办公交付通过。客户端应读取返回的认领、回执和事件状态，并保留失败、部分覆盖和 `unverified` 项。

对应能力返回 `false` 或宿主未注册处理器时，接口返回 `503`。不要把“路由存在”当成“当前会话可执行”。

管理策略拒绝响应保留该次实际检查的 revision，并带可追踪来源：

```json
{
  "error": "管理策略禁止 provider.request。来源：机器策略（C:\\ProgramData\\MingshenHarness\\managed-policy.json）",
  "code": "POLICY_BLOCKED",
  "policyRevision": "<combined-current-revision>",
  "policySources": [
    {
      "layer": "machine",
      "revision": "<machine-layer-revision>",
      "decision": "deny",
      "reason": "机器策略将 provider.request 设为 deny",
      "path": "C:\\ProgramData\\MingshenHarness\\managed-policy.json"
    }
  ]
}
```

`policyRevision` 是拒绝发生时与 `policySources` 同一次读取的整体 revision，可能晚于运行接纳记录中的 `run.policyRevision`。客户端应以实际拒绝响应为准，并在重试前重新读取有效策略；不能把运行接纳时快照当作本次失败原因。

运行记录另有一个可选的 `lastPolicyDenial`，保存该 `runId` 最近一次真实拒绝的 `revision`、`code`、`reason`、`scope`、`sources` 和 `at`。接纳时的 `run.policyRevision` 是运行接纳快照，后续策略拒绝只更新 `lastPolicyDenial`，不会改写接纳 revision 或把仍在运行的运行误标为终态。拒绝元数据与 `runtime.policy_denied` 事件在同一数据库事务中保存；即使持久事件达到 30 天或 256 MiB 上限后被清理，运行记录中的最新拒绝元数据仍可由运行查询和会话快照读取。实现会对 revision、原因、来源数量和各文本字段做有界截断，不应依赖这些诊断字段保存任意大对象或秘密。

#### 认领、结算与人工恢复

创建认领时必须提供 `sessionId`、`runId`、`ownerSessionId`、`stepId` 和当前整数 `revision`。运行必须属于声明的执行者会话且尚未终态；执行者只能是规范计划会话本身或其直接子会话。心跳只接受精确的 `claimId` 与 `ownerRunId`，默认每 60 秒续租、租约 5 分钟。终态运行不能续租或直接结算。

直接 `settle` 只接受仍为 `active` 且租约有效的认领，状态只能是 `completed` 或 `released`。请求必须把调用方最近一次读取的 `claimVersion` 作为正安全整数 `expectedVersion` 提交：

```json
{
  "action": "settle",
  "claimId": "<claim-id>",
  "ownerRunId": "<owner-run-id>",
  "status": "completed",
  "expectedVersion": 7,
  "summary": "Verified the resulting file and checks.",
  "evidence": ["<successful-check-tool-call-id>"]
}
```

省略 `expectedVersion`、传入字符串、非整数、小于 1 或超出安全整数范围时返回 `400 PLAN_CLAIM_INVALID`。心跳续租或其他认领变更会推进 `claimVersion`；若提交的是变更前读数，返回 `409 PLAN_CLAIM_CLAIM_VERSION_CONFLICT`。发生该冲突后必须重新读取认领并重新核实当前副作用，不能自动重试旧状态。内部自动结算为兼容旧调用可选择省略该字段，但外部 `/v1` 客户端不适用此兼容路径。

宿主还要求精确的 `ownerRunId` 仍是聊天运行时中的 live owner、运行记录属于认领的执行者会话且尚未终态、计划 generation 未变化。认领仍有活动工具调用、运行中的命令、命令清理状态、文件租约、未解决的执行安全状态或工作区写屏障时，不能直接结算。不能把不确定副作用报告为完成。

过期或收到取消请求的认领只能使用 `recover`：

```json
{
  "action": "recover",
  "sessionId": "<canonical-plan-session>",
  "claimId": "<claim-id>",
  "expectedVersion": 7,
  "summary": "Inspected the stopped run and current files; no replay is required.",
  "inspectionCallIds": ["<successful-read-tool-call-id>"]
}
```

恢复要求所属运行为终态，并由宿主在内部确认该精确运行的进程清理已经停止；这不是客户端请求字段。宿主还会检查执行者没有活动或准备中的运行、委派运行已结束、共享工作区不存在其他活动写入者，并读取正确执行者会话的检查点。检查点、恢复屏障或工作区写入屏障表明副作用不确定时，每个不确定 effect 都要由 final uncertain effect 之后成功完成的不同只读工具或 MCP inspection call 覆盖；`inspectionCallIds` 只是这些真实调用 ID 列表，不能代替宿主检查。`expectedVersion` 必须等于最近读取的 `claimVersion`；恢复成功后认领变为 `released`，步骤回到 `pending`，不会自动重放旧工具。

## 兼容旧接口

原有本地接口继续保留，包括健康、Agent、会话、消息、审批、提问、MCP、LSP、轨迹和分享链接。新集成应优先使用 `/v1` 的运行接纳和事件接口，因为旧接口不具备同等的幂等、精确运行停止和持久续接语义。

旧接口同样只监听回环地址并使用 Bearer Token。不要假定旧客户端能在服务重启后继续使用原 Token。

## JavaScript SDK

随包 SDK 位于安装目录的 `resources/sdk/`。项目使用 Node.js 24 或更高版本。

```js
import { randomUUID } from "node:crypto";
import { MingshenClient } from "./mingshen-client.mjs";

const client = new MingshenClient({
  baseUrl: "http://127.0.0.1:4096",
  token: process.env.MINGSHEN_SERVER_TOKEN,
});

await client.health();
const snapshot = await client.snapshot(sessionId);
const accepted = await client.createTurn(
  sessionId,
  "检查当前项目并汇报真实测试结果",
  randomUUID(),
);

for await (const envelope of client.runtimeEvents({
  after: snapshot.eventCursor,
  runId: accepted.runId,
  signal: AbortSignal.timeout(30 * 60 * 1000),
})) {
  console.log(envelope.type, envelope.event);
}
```

SDK 的 `runtimeEvents()` 会从最后收到的持久 `id` 自动重连。遇到认证失败会抛出明确的认证错误；遇到 `CURSOR_EXPIRED` 会要求先取新快照。业务代码仍应保存 `runId` 和最后游标，不应只依赖进程内变量。

认领方法为 `claims(query)`、`claimTask(input)`、`heartbeatTask(claimId, ownerRunId)`、`settleTask(input)` 和 `recoverTask(input)`。办公交付方法为 `receipts(query)`、`officeReceipt(deliveryId)` 和 `officeReceiptAction(input)`；最后一个方法只提交 `prepare` 或 `check`。`visual-batch` 和 `record-visual` 只存在于桌面宿主的内部视觉续接，不通过外部 SDK 接受不可信证据。所有 Promise 仍须按 HTTP 状态、返回 `code`、认领所有者及回执哈希判断，不应把网络层成功当作业务完成。

## CLI

CLI 连接已运行的桌面或托盘进程，不创建独立服务。实际 loopback 专项已用 spawned CLI 验证 capabilities、snapshot、run 和 Token 轮换后的认证失败，并确认 JSON/NDJSON 输出保持单行；这不等于所有子命令均已完成现场联测。

```powershell
$env:MINGSHEN_SERVER_URL = "http://127.0.0.1:4096"
$env:MINGSHEN_SERVER_TOKEN = "<current token from Settings>"

node "<Mingshen install directory>\resources\sdk\mingshen-cli.mjs" capabilities
node "...\mingshen-cli.mjs" prompt <sessionId> "检查项目并运行测试"
node "...\mingshen-cli.mjs" watch <runId> --events
```

支持命令：

```text
health
capabilities
sessions
session <sessionId>
snapshot <sessionId>
new --provider <id> --model <id> [--title text] [--workspace path]
prompt <sessionId> <text|->
run <runId>
watch <runId> [--events]
cancel <runId>
policy [sessionId]
claims [key=value ...]
claim '<claim-json>'
heartbeat <claimId> <ownerRunId>
settle '<settle-json>'
recover '<recover-json>'
receipts [key=value ...]
receipt '<receipt-action-json>'
```

`claims` 与 `receipts` 执行 GET 查询；`claim`、`heartbeat`、`settle`、`recover` 和 `receipt` 分别提交对应写动作。`settle` 和 `recover` 都必须携带最近读取的正整数 `expectedVersion`；心跳后应重新读取最新 `claimVersion`，不能继续使用旧值。`receipt` 的 `prepare` 目标必须是当前会话工作区内相对路径。全局参数为 `--url`、`--token`、`--json` 和 `--ndjson`。`prompt` 可从标准输入读取 `-`。认证失败、服务未启动或 Token 已轮换时，CLI 明确失败，不会自行启动第二个服务。

## ACP bridge

启动本地服务后，将以下命令配置为 ACP 兼容编辑器启动项：

```powershell
$env:MINGSHEN_SERVER_URL = "http://127.0.0.1:4096"
$env:MINGSHEN_SERVER_TOKEN = "<current token from Settings>"
node "<Mingshen install directory>\resources\sdk\mingshen-acp.mjs"
```

ACP bridge 使用 newline-delimited JSON-RPC over stdio，将聊天、推理、工具和完成事件映射为 `session/update`。当前 `mingshen-acp.mjs` 通过 `/v1/events?after=<cursor>` 查询参数恢复；`Last-Event-ID` 请求头是服务端为其他 SSE 客户端提供的兼容路径，不是该 bridge 当前的续接实现。运行查询绑定准确 `runId`，并只广告 `/v1/capabilities` 返回的权限模式。

- 同一 ACP 会话同一时间只接受一个活动 prompt。
- `run_completed`、`run_failed`、`run_interrupted` 和 `blocked_policy` 都会结束等待。
- `session/cancel` 只停止该会话的活动运行。
- 停止请求默认最多等待 10 秒；`MINGSHEN_ABORT_TIMEOUT_MS` 可设 50 到 60000 毫秒。
- HTTP 失败、网络异常或超时返回“远端停止未确认”，不能假报停止成功。
- ACP 客户端请求 `full_access` 不能绕过管理策略或当前会话允许的权限模式。
- ACP 只接受本 bridge 进程创建的会话；`session_added` 也不会让外部会话 ID 获得所有权。订阅使用全局持久事件流，游标会为每个带 `id:` 的持久帧前进，即使该帧过滤后不属于当前 ACP 会话；这样重连时使用真实全局位置，不会为无关事件重复回放。没有 `id:` 的正文或思考增量不推进游标。

## 错误与恢复约定

| HTTP 状态或代码 | 处理 |
| --- | --- |
| `400 RUNTIME_VALIDATION_ERROR` | 修正请求、会话 ID 或幂等键 |
| `400 PLAN_CLAIM_INVALID` | 补齐认领动作字段；外部 `settle` 必须提供正安全整数 `expectedVersion`，并核对状态、所有者和当前认领 |
| `401` | 重新从设置取得当前 Token；服务重启后旧 Token 已失效 |
| `404 RUNTIME_NOT_FOUND` | 重新读取会话或运行；不要猜测 `runId` |
| `409 IDEMPOTENCY_CONFLICT` | 原键已用于不同请求，生成新键并重新确认意图 |
| `409 PLAN_CLAIM_PLAN_CHANGED` | 重新读取规范计划和 generation，不要复用旧步骤版本 |
| `409 PLAN_CLAIM_CLAIM_VERSION_CONFLICT` | 重新读取认领并再次核对真实副作用，旧版本不能冒充成功 |
| `409 PLAN_CLAIM_RUN_TERMINAL` | 终态运行不能续租或直接结算；转入人工恢复流程 |
| `403 OFFICE_EXTERNAL_VISUAL_EVIDENCE_UNTRUSTED` | 外部客户端不能提交视觉批次或“已验证”记录；改用宿主 `check` 自动生成受控证据 |
| `410 CURSOR_EXPIRED` | 获取新会话快照并从新游标续接 |
| `503` | 对应运行时或开发者处理器当前不可用；读取 `/v1/capabilities` |

客户端超时不是服务端取消。要停止运行，调用准确 `runId` 的 cancel 接口，并等待运行终态。

## 本地诊断

桌面 IPC 与本地 API 的已处理失败会进入本地运行日志；API 的 `4xx` 响应记录为警告、`5xx` 记录为错误，使用有界静态路由模板和状态信息，不把 Bearer Token、查询内容、动态路径 ID 或请求正文作为日志记录。正常 SSE 关闭或断开不算错误；订阅建立后的回放异常会单独记录。失败响应不代表它一定是应用缺陷：例如 `401`、参数校验、权限拒绝和客户端冲突应按返回状态处理。后台工具、插件 Hook 和办公检查另以有界状态/代码记录异常或未完成检查，不主动保存工具输出或文档正文。正常请求不记为错误。

SDK、CLI 和 ACP 是连接桌面服务的独立客户端：只有实际抵达宿主的调用及宿主内部产生的事件能计入桌面日志。桌面服务尚未运行、客户端本地参数无效或网络在抵达服务前中断等独立进程错误，不会自动写入当时未运行或未收到请求的桌面日志，应另行查看客户端输出。

在 **设置 → 运行日志** 查看和导出当前留存记录的错误、警告、来源与操作统计。日志最多保留 30 天、五个轮换文件合计最多 15 MiB；已知过载、写盘失败遗漏及损坏记录单列。写盘失败后尚未附加到下一条成功记录的遗漏暂存于进程内，状态和导出会显示，进程崩溃后不能恢复未持久化计数。统计按记录而非去重后的独立事件计算，不是服务历史总数；不要把接口诊断日志与 `/v1/events` 的 30 天 / 256 MiB 运行事件保留策略混为一谈。日志只在本机保存，不自动上传；第三方错误和旧日志仍可能含敏感信息，分享前应自行检查。

## 当前验证边界

当前文档覆盖源码接口、SDK/CLI/ACP 连接约定和错误语义。真实 loopback 专项已使用实际 `HeadlessServerService` + Runtime + 临时 SQLite、实际随包 SDK 和 spawned CLI 验证：capabilities、两次创建/查询/完成快照、准确停止首个运行且保留第二个、服务重启 Token 轮换、SDK 旧 Token 类型化失败、CLI 旧 Token 以退出码 1 给出认证提示，以及 CLI capabilities/snapshot/run 的 NDJSON 单行输出。临时脚本、数据库、服务和目录已清理。

该专项的 ChatService 是 `admitTurn` 合约桩，不是真实模型或完整 chat loop；`headless-idempotency.integration.test.ts` 另有真实 Chat 接纳的 full 定向 **1/1** 通过。计划认领的窄范围冻结定向为 **3 文件、40/40**，外部 `settle.expectedVersion` 必填、正安全整数校验和心跳后旧版本 `409` 已有直接覆盖；较早 **39/39** 是不同阶段结果。完整桌面、快捷 Chat、桌宠、API、SDK 与 ACP 状态一致性，断线、游标过期、并发 prompt、策略拒绝、全部 SDK 方法、真实第三方编辑器和正式安装升级仍未验收。
