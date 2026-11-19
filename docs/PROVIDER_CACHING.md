# Gemini / DeepSeek 缓存适配说明

适用版本：1.3.3。官方资料核查日期：2026-11-11。本文区分供应商机制、当前客户端实现与尚未进行的真实计费验证；用户操作说明同时内置于中英文使用手册。

## 为什么需要适配

提示缓存复用的是服务端认定可复用的历史前缀。固定系统提示和工具定义并不充分：工具续接还可能需要供应商返回的签名或原生推理字段，客户端重新生成助手历史时丢掉这些字段，会改变请求表示或破坏续接。当前实现因此同时保持前缀与必要的原生状态，而不是通过统一添加某个“缓存开启”参数提高命中率。

Google 说明 Gemini 支持自动的隐式缓存和单独创建资源的显式缓存；公共长前缀的位置与后续请求间隔会影响隐式复用，命中不保证。显式缓存有独立的有效期和存储计费，不能把 OpenAI 的 `prompt_cache_key` 当作 Gemini 缓存资源。DeepSeek 的上下文缓存同样由服务端自动处理重复前缀，命中与未命中用量分别报告。[1][2][5]

本版本在原有三种协议之外增加 Google Gemini 原生 GenerateContent；不实现 Vertex AI 或 Google Interactions，也不声称所有兼容网关都提供相同的缓存或原生字段。

## 配置与官方识别

在设置 → 供应商与模型 → 选择供应商 → 连接 → 提示缓存中：

1. 官方 API 可保留“仅自动识别官方 API”；网关选择实际的 Gemini / DeepSeek 模型体系，并确认服务端透传相应原生字段。
2. 缓存方式保留“按模型体系适配 / 官方自动识别”，点击“保存缓存配置”，下一次运行生效。不要为官方 Gemini / DeepSeek 选择仅属于其他服务的缓存参数。
3. 使用供应商实际支持的 Model ID、能力、上下文及输出限制；模型体系不会更换模型或翻译协议。混合模型供应商建议拆分配置。

下表列出客户端自动识别的 Gemini / DeepSeek 范围。地址末尾可带 `/`；域名、路径、协议必须对应，不接受在地址中加入凭据、查询参数或锚点。其他路径不会因包含品牌名称而自动获得相应体系。

| 体系 | 应用协议 | Base URL |
| --- | --- | --- |
| Gemini | Google Gemini 原生 GenerateContent | `https://generativelanguage.googleapis.com/v1beta`（`x-goog-api-key`） |
| Gemini | Chat Completions | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | Chat Completions | `https://api.deepseek.com`、`https://api.deepseek.com/v1`、`https://api.deepseek.com/beta` |
| DeepSeek | Responses | `https://api.deepseek.com`、`https://api.deepseek.com/v1` |
| DeepSeek | Anthropic Messages | `https://api.deepseek.com/anthropic/v1` |

前三种协议分别追加 `/chat/completions`、`/responses`、`/messages`；Gemini 原生追加 `/models/{model}:streamGenerateContent?alt=sse`，连接测试使用 `:generateContent`。不要把端点重复填写到 Base URL。原生网关允许以 `/v1beta` 或 `/v1` 结尾，其余通用网关仍按现有 `/v1` 校验。原生协议固定采用 Gemini 体系；手动选择体系不会翻译协议或扩大鉴权权限。原有 OpenAI / Claude 官方地址识别继续保留。

Gemini / DeepSeek 自动缓存策略为隐式模式：不自动附加 OpenAI 缓存键、Claude `cache_control` 或其他供应商提示，不创建收费的 Gemini 显式缓存资源。选择“不发送缓存参数”也不能关闭服务端自身的隐式缓存。界面的 Claude 保留时间只适用于确认支持的 Claude 缓存方式，不能控制二者的服务端有效期。

## 原生续接状态

Google 要求保留模型实际返回的 thought signatures，并按原内容位置和顺序回传。官方 ADK 的 OpenAI 兼容转换器支持消息及流式 delta 的 `extra_content.google.thought_signature`；工具调用同样可携带该扩展。DeepSeek 思考模式的工具续接需要返回的原生推理字段，各兼容协议的表示不同。[3][4][6][7][8]

当前只保留通过格式、容量与完成状态检查的已返回内容：

| 体系与协议 | 保留的实际响应 |
| --- | --- |
| Gemini 原生 GenerateContent | 返回的完整 model Parts，保留 text/thought、functionCall、可选 id、thoughtSignature、空文本及签名所在 Part 的原边界 |
| Gemini Chat Completions | 助手消息及 function tool call 上的 Google thought signature |
| DeepSeek Chat Completions | `reasoning_content` 与对应的助手正文、工具调用 |
| DeepSeek Responses | 明文 `reasoning_text` 项及对应的 message / function_call 项；不请求 OpenAI 加密推理 include |
| DeepSeek Anthropic Messages | thinking、text、tool_use 内容块及返回的可选 signature，按原块顺序续接 |

原生状态以 `provider_state` 随会话保存在本地。重放须同时满足相同的供应商配置、模型 ID、协议和端点作用域，并再次核对可见正文、工具 ID、名称、参数及顺序。切换模型、协议或端点，或编辑到内容不一致时，不使用原作用域状态；普通可见历史继续按现有协议构建。返回字段畸形、冲突、超出容量、未完成或取消时不补造状态。

应用不从界面上的思考文字构造 `reasoning_content`，也不制造签名、拼接不兼容协议或索取 API 没有返回的隐藏推理。旧历史缺少原生字段时不能追溯补全，因此升级后旧会话可能仍存在前缀差异。需要对照时在新会话中使用相同供应商、模型和设置，观察连续请求及实际工具续接。

原生 Gemini 使用 `systemInstruction`、`contents/parts`、`generationConfig` 与工具 `parametersJsonSchema`。每个独立 functionCall 分配应用内部 ID 配对结果，同名工具仍按原顺序生成同一个 user 消息中的 functionResponse；没有服务端 ID 时不向 Google 补造 ID。`STOP` 后只接收空文本/签名尾部及用量，不合并或重排签名 Part。达到输出上限、安全拦截、畸形工具、截断或取消时不保存原生状态、不执行工具。[10][11][12]

原生思考配置：留空或 `auto` 不发 `thinkingConfig`；Gemini 2.5 Flash 的 `none` 使用 `thinkingBudget:0`，2.5 Pro 拒绝关闭，2.5 不将 low/high 等等级猜测为 token budget。3 及以上按所选模型支持发送 `thinkingLevel` 及 `includeThoughts:true`。具体可选等级仍由模型决定。工具选择使用 AUTO/NONE，原生接口没有 OpenAI `parallel_tool_calls` 开关；本地是否并行执行读取仍受模型配置及应用权限限制。[10][11]

Token Saver 保持带原生状态消息的可见正文与工具配对完整，不做结构化精简、摘录或去重；指纹包括作用域和状态内容摘要，替换记录不复制不透明载荷。独立文本摘要不透传 `provider_state` 或不透明签名，可见正文按已有摘要规则处理；普通 UI 推理也不能作为可重放原生状态。上下文压缩仍会合法重建部分历史，不能无限累积原始历史只为维持缓存。

## DeepSeek 思考参数

当前官方 Chat 文档规定，显式 `thinking` 优先；省略或为 null 时根据 `reasoning_effort` 判断，`none` 关闭，`low`、`high`、`max` 启用，两者均省略时默认启用。应以所选模型和网关的当期文档为准。[6][9]

客户端对用户选定等级的映射为：

- Chat：`none` 显式发送 disabled；所选启用等级发送 enabled 与 `reasoning_effort`。
- Responses：使用 `reasoning.effort`。
- Anthropic：显式 thinking 开关及启用时的 `output_config.effort`。
- 等级未选择：不主动覆盖 API 默认行为。

应用不在代码中写死每个模型的缓存最低 token 数或有效期；这些能力、参数支持、可选等级和价格会变化。改变思考等级也可能改变请求表示，按任务需要选择后保持一致比频繁切换更便于诊断。

## 用量与排查

CTX → Token Saver 的缓存读取来自供应商报告，而不是前缀结构的推测。DeepSeek 的 `prompt_cache_hit_tokens` 已包含在完整 prompt 总量中，不能再重复加到输入；仅有命中/未命中计数时可以推导完整输入。Gemini 网关若返回原生 `usageMetadata` / `usage_metadata`，使用已报告的 prompt、cached-content、candidates、thoughts 与 total 字段作兼容备用读取；这不表示其 OpenAI 兼容接口一定采用原生字段。[4][9][10]

有效标准 usage 字段优先，包括明确的 0。未报告缓存字段保持未知；负数、非整数、溢出、缓存量超出输入或互相冲突的计数不拼成有效命中。原生 Gemini 输出备用计数纳入已报告思考 token，完整 total 以供应商报告为准，不丢掉可能存在的工具开销。没有写入字段时不编造缓存写入量。

排查时区分：

- **前缀变化**：CTX 中的前缀诊断用于比较同一会话、用途的实际请求；工具/系统/历史、模型、端点或认证配置变化可能建立新基线。诊断结构一致仍不证明服务端缓存有效。
- **未报告**：网关未透传缓存统计时，界面显示未知，不能据此认定零命中。
- **明确零命中**：已返回 0 仍可能由模型最低长度、过期、路由或首次请求导致；软件不保证固定缓存率。
- **缺少原生状态**：历史记录或网关没有返回所需字段时，应用不能重建。应确认协议及网关透传，再观察新会话中的连续工具请求。

本轮使用本地模拟协议、单元测试和隔离数据验证客户端行为，没有发起付费供应商请求或宣称真实缓存率已经达到某个数值。具体执行结果由版本验证记录维护。

## 数据与边界

DeepSeek 实际返回的明文推理与 Gemini 不透明签名属于本地会话数据；它们不等于 safeStorage 凭据密文。原生续接只回到匹配的既有供应商范围，不新增 Mingshen 或腾讯云端接收方。导出、复制数据库和共享会话前应检查这些数据；删除本地会话不撤回已经发送给供应商的内容。完整说明见[隐私政策](PRIVACY_POLICY.md)。

版本保持 1.3.2，新增 schema8 迁移扩展供应商协议和鉴权约束，保留 schema1–7 历史迁移、原数据及政策修订号 `2026-11-04.3`。已有 1.3.1 安装包及发布 SQL 是历史材料，本轮未生成或发布 1.3.2 安装包。

## 官方来源

以下均为官方文档或官方项目源码，核查于 2026-11-11。动态网页和 `main` 分支以后可能更新；具体支持以实际接口、模型和网关当期文档为准。

1. [Google Gemini：Context caching](https://ai.google.dev/gemini-api/docs/caching)
2. [Google Gemini：OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
3. [Google Gemini：Thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)
4. [Google ADK Java：ChatCompletionsResponse](https://github.com/google/adk-java/blob/main/core/src/main/java/com/google/adk/models/chat/ChatCompletionsResponse.java)
5. [DeepSeek：Context Caching](https://api-docs.deepseek.com/guides/kv_cache)
6. [DeepSeek：Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
7. [DeepSeek：Responses API](https://api-docs.deepseek.com/guides/responses_api)
8. [DeepSeek：Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)
9. [DeepSeek：Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
10. [Google Gemini API：GenerateContentResponse / UsageMetadata](https://ai.google.dev/api/generate-content)
11. [Google 官方 API discovery：GenerateContent、FunctionCall、ThinkingConfig 与模型分页定义](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta)
12. [Google Gen AI JavaScript SDK：流式会话历史保留](https://github.com/googleapis/js-genai/blob/main/src/chats.ts)

本轮原生协议核查直接读取了第10项API文档、第11项机器可读定义和第12项官方SDK源码。当前转向 Interactions 的思考介绍不能套用为 GenerateContent 参数；无法取得正文的 thought-signatures 页面重定向也不算逐字复核。
