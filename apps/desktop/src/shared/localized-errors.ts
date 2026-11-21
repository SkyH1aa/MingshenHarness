const errors: Record<string, string> = {
  "Gemini 原生 Base URL 必须以 /v1beta 或 /v1 结尾，不含 /openai 或模型端点。":
    "Native Gemini Base URL must end in /v1beta or /v1, without /openai or a model endpoint.",
  "鉴权方式无效。": "Invalid authentication mode.",
  "Gemini 2.5 原生协议请使用默认思考；Flash 可选择 none，Pro 不支持关闭思考。":
    "Use default thinking with native Gemini 2.5. Flash also accepts none; Pro cannot disable thinking.",
  "Gemini 原生思考等级支持 minimal、low、medium、high；可用等级由具体模型决定。":
    "Native Gemini thinking levels are minimal, low, medium and high. Supported levels depend on the model.",
  "Gemini 连接测试未返回完整文字，请检查安全拦截、模型输出预算和响应详情。":
    "Gemini did not return complete test text. Check safety blocking, the output budget and response details.",
  "模型列表不是有效 Gemini JSON。": "The model list is not valid Gemini JSON.",
  "Gemini 模型列表分页标识无效。": "Invalid Gemini model-list page token.",
  "Gemini 模型列表分页重复。": "Repeated Gemini model-list page token.",
  "模型列表超过读取上限。": "The model list exceeds the read limit.",
  "Base URL 必须以 /v1 结尾，或使用 Gemini /v1beta/openai、DeepSeek 官方 API 地址。":
    "Base URL must end in /v1, or use the official Gemini /v1beta/openai or DeepSeek API address.",
  "应用正在退出或安装更新，请稍后重载界面。":
    "The application is closing or installing an update. Reload the interface later.",
  "有会话正在运行或准备中，请等待全部任务完成后重载界面。":
    "A conversation is running or preparing. Wait for all tasks to finish before reloading the interface.",
  "应用窗口不可用，请重新启动应用。":
    "The application window is unavailable. Restart the application.",
  "计划已更新，请刷新后再保存。": "The plan changed. Refresh it before saving.",
  "计划最多包含 200 个步骤。": "A plan can contain at most 200 steps.",
  "计划步骤无效。": "Invalid plan step.",
  "计划步骤无效或 ID 重复。": "Invalid plan step or duplicate ID.",
  "计划依赖不能形成循环。": "Plan dependencies cannot form a cycle.",
  "计划依赖的步骤不存在。": "A plan dependency refers to a missing step.",
  "开始步骤前需要完成其依赖步骤。": "Complete the dependencies before starting this step.",
  "暂停状态无效。": "Invalid pause state.",
  "断点配置无效。": "Invalid breakpoint configuration.",
  "计划已暂停。": "The plan is paused.",
  "计划已暂停，请从任务面板继续。": "The plan is paused. Continue it from the task panel.",
  "模型未确认旧计划是否继续。计划已保留，请启用工具调用后重试或在任务面板清空计划。":
    "The model did not review the previous plan. It is preserved. Enable tool calls and retry, or clear it in the task panel.",
  "模型未确认旧计划是否继续。计划已保留，请重试或在任务面板编辑计划。":
    "The model did not review the previous plan. It is preserved. Retry or edit it in the task panel.",
  "没有可恢复的中断任务。": "No interrupted task is available to resume.",
  "子会话不存在或不属于当前会话。":
    "The child conversation is missing or does not belong to this conversation.",
  "子会话 ID 无效。": "Invalid child conversation ID.",
  "同一工具已有待处理的审批，请处理现有请求。":
    "This tool already has a pending approval. Handle the existing request.",
  "正在验证测试、Lint 与类型检查": "Verifying tests, lint and types",
  验证未通过: "Verification failed",
  验证阶段完成: "Verification completed",
  "子 Agent 不能通过停止父任务转移写入权。请让父 Agent 协调该文件的修改。":
    "A child Agent cannot stop its parent to take write access. Ask the parent Agent to coordinate changes to this file.",
  "请先阅读使用手册。": "Read the user guide first.",
  "审批模型返回格式无效或缺少原因，未采用该结果。":
    "The approval response format is invalid or its reason is missing. This result was not used.",
  "自动审批未完成，请手动处理。": "Automatic review did not complete. Decide manually.",
  "请先选择主审批模型，再配置备用模型。":
    "Choose a primary approval model before configuring a backup.",
  "备用模型不能与主模型相同。": "The backup model must be different from the primary model.",
  "主审批模型失败，正在使用备用审批模型。":
    "The primary approval model failed. Reviewing with the backup model.",
  "主压缩模型失败，正在使用备用压缩模型。":
    "The primary compaction model failed. Compacting with the backup model.",
  主审批模型失败: "Primary approval model failed",
  备用审批模型失败: "Backup approval model failed",
  主压缩模型失败: "Primary compaction model failed",
  备用压缩模型失败: "Backup compaction model failed",
  "当前单条输入或固定提示已超出上下文窗口，无法通过历史摘要缩小。请缩小输入或选择更大上下文的模型。":
    "The current input or fixed prompt exceeds the context window and cannot be reduced by summarizing history. Shorten the input or choose a model with a larger context window.",
  "压缩模型配置无效。": "Invalid compaction model configuration.",
  "压缩模型不存在、已禁用或不属于所选供应商，请重新配置。":
    "The compaction model is missing, disabled or belongs to another provider. Reconfigure it.",
  "上次上下文压缩已中断，原始记录已保留，下次运行将重试。":
    "Previous context compaction was interrupted. Original history is preserved; the next run will retry.",
  "压缩模型的上下文或输出上限过小，请更换压缩模型。":
    "The compaction model context or output limit is too small. Choose another model.",
  "历史记录过大，已停止本次压缩；原始记录已保留。":
    "History is too large for this compaction attempt. Original records are preserved.",
  "压缩模型无法容纳摘要，请选择更大上下文的模型。":
    "The compaction model cannot fit the summary. Choose a larger context window.",
  "压缩模型返回了工具调用，未采用本次摘要。":
    "The compaction model returned a tool call. This summary was not used.",
  "压缩摘要过长，未采用本次摘要。": "The summary is too long and was not used.",
  "压缩模型多次耗尽输出预算，已要求更简短摘要，原始记录已保留。请检查模型最大输出及思考设置，或更换压缩模型。":
    "The compaction model repeatedly exhausted its output allowance after requests for a shorter summary. Original history is preserved. Check the model output and reasoning settings, or choose another compaction model.",
  "压缩模型返回的摘要超过分段预算，未替换原有摘要。请减小压缩模型输出上限或更换模型。":
    "The compaction response exceeded the summary-segment budget. The previous checkpoint is unchanged. Reduce the compaction output limit or choose another model.",
  "压缩模型未返回有效摘要，原始记录已保留。":
    "The compaction model returned no valid summary. Original history is preserved.",
  "本次摘要未缩小上下文，原始记录已保留。请更换压缩模型或缩小单条输入。":
    "The summary did not reduce context size. Original history is preserved. Choose another compaction model or shorten the oversized input.",
  "自动压缩失败，原始记录已保留，请检查压缩模型后重试。":
    "Automatic compaction failed. Original history is preserved. Check the compaction model and retry.",
  "审批模型配置已变更，请手动处理或重新发起自动审批。":
    "The approval model configuration changed. Decide manually or restart automatic review.",
  "APPROVAL_MODEL_REQUIRED: 审批模型的 API Key 不可用，请在设置中检查供应商凭据。":
    "APPROVAL_MODEL_REQUIRED: The approval model API key is unavailable. Check provider credentials in Settings.",
  "审批模型未返回有效的通过/不通过及原因，请手动审批。":
    "The approval model returned an invalid verdict or reason. Decide manually.",
  "审批模型尝试调用工具，请手动审批。":
    "The approval model attempted a tool call. Decide manually.",
  "审批模型返回内容过长，请手动审批。": "The approval response is too long. Decide manually.",
  "操作参数过长，无法自动审核，请手动审批。":
    "Operation arguments are too long for automatic review. Decide manually.",
  "APPROVAL_MODEL_REQUIRED: 请先在设置的权限与安全中配置审批模型。":
    "APPROVAL_MODEL_REQUIRED: Configure an approval model in Permissions & security settings first.",
  "此操作必须手动单独批准。": "This operation requires separate manual approval.",
  "最大工具轮次必须为 1 到 10000 的整数。":
    "The tool-step limit must be a whole number from 1 to 10000.",
  "请先从设置中恢复已归档会话，再继续任务。":
    "Restore this archived conversation in Settings before continuing.",
  "请先停止会话及其子任务，再归档。":
    "Stop this conversation and its child tasks before archiving.",
  "会话目录发生变化，请刷新后重试。": "The conversation list changed. Refresh it and try again.",
  "会话的工作文件夹或归档状态已变化，请刷新后重试。":
    "The conversation's folder or archive status changed. Refresh the list and try again.",
  "自动清理天数必须为 1 到 36500 的整数，或选择永不删除。":
    "Retention must be a whole number from 1 to 36500 days, or Never delete.",
  "工作目录无效。": "Invalid workspace folder.",
  "此会话尚未设置工作目录。": "No working directory is set for this conversation.",
  "工作目录不存在或无法访问，请检查会话的工作目录。":
    "The working directory is missing or inaccessible. Check this conversation's working directory.",
  "工作目录不是文件夹，请重新选择工作目录。":
    "The working directory is not a folder. Choose a working directory again.",
  "无法打开工作目录：": "Could not open the working directory: ",
  "该工作目录没有可继承配置的主会话，请先通过“新对话”创建。":
    "No primary conversation is available in this folder. Create one with New conversation first.",
  "上一会话的供应商或模型已被删除，请先重新配置该会话。":
    "The previous conversation's provider or model was removed. Reconfigure that conversation first.",
  "附件名称长度必须为 1 到 255 个字符。": "Attachment names must contain 1 to 255 characters.",
  "附件超过单文件 25 MiB 限制。": "The attachment exceeds the 25 MiB per-file limit.",
  "工具参数必须是 JSON 对象。": "Tool arguments must be a JSON object.",
  "会话不存在。": "Conversation not found.",
  "该会话正在删除。": "This conversation is being deleted.",
  "该会话正在运行，请先停止或等待完成。":
    "This conversation is running. Stop it or wait for completion.",
  "该会话正在运行，请先停止任务。": "Stop the running task first.",
  "会话尚未选择模型。": "Select a model for this conversation first.",
  "消息和附件不能同时为空。": "Enter a message or attach a file.",
  "运行中引导记录损坏，原数据未覆盖。":
    "Saved run guidance is damaged. The original data has not been overwritten.",
  "该会话不支持运行中引导。": "This conversation does not support run guidance.",
  "该会话已有运行中引导状态。": "This conversation already has an active guidance state.",
  "运行标识已存在。": "This run identifier already exists.",
  "运行中引导格式无效。": "Invalid run guidance input.",
  "运行中引导仅支持文字，不支持附件或临时指令。":
    "Run guidance supports text only, without attachments or a temporary instruction.",
  "运行中引导文本格式无效。": "Invalid run guidance text.",
  "引导文本须为 1 至 8000 个字符。": "Guidance must contain 1 to 8000 characters.",
  "引导请求标识已用于不同内容。":
    "This guidance request identifier has already been used for different content.",
  "运行中引导状态不存在。": "The guidance state for this run is missing.",
  "最多等待 10 条引导。": "At most 10 guidance messages can wait to be included.",
  "本次运行的引导总长度不能超过 32000 个字符。":
    "Guidance for this run cannot exceed 32000 characters in total.",
  "运行中引导投递标识无效。": "Invalid guidance delivery identifiers.",
  "运行中引导投递顺序已变化。": "The guidance delivery order has changed.",
  "运行中引导不存在。": "Run guidance was not found.",
  "当前运行已结束，不能接收引导。": "This run has ended and cannot accept guidance.",
  "运行中引导无法完整加入模型上下文，原文已保留。":
    "Guidance could not be included in full in the model context. The original text is preserved.",
  "会话的供应商或模型配置已失效。":
    "The conversation's provider or model configuration is no longer available.",
  "只能修改或重试用户消息。": "Only user messages can be edited or retried.",
  "自动重试次数必须是 0 到 20 之间的整数。":
    "Automatic retries must be an integer between 0 and 20.",
  "子 Agent 会话不能继续创建子 Agent。": "Subagents cannot create additional subagents.",
  "用户拒绝了 Docker 环境构建。": "Docker environment build was denied.",
  "模型没有返回可显示内容或工具调用。": "The model returned no displayable content or tool calls.",
  "工具调用轮次达到上限，已停止以避免无限循环。":
    "The tool-step limit was reached. Execution stopped to prevent an infinite loop.",
  "子 Agent 并发数必须是有效数字。": "Subagent concurrency must be a valid number.",
  "当前运行的子 Agent 数量高于新上限，请等待任务完成后再降低上限。":
    "More subagents are running than the new limit allows. Wait for them to finish before lowering it.",
  "工具调用轮次达到上限，子 Agent 结果已保存。请继续会话以完成汇总。":
    "The tool-step limit was reached. Subagent results were saved. Continue the conversation to complete the summary.",
  "当前 Agent 配置不允许调用该子 Agent。": "This agent profile cannot invoke that subagent.",
  "运行轨迹不存在。": "Run trace not found.",
  "只能使用 http 或 https 打开外部链接。": "External links must use HTTP or HTTPS.",
  "文件路径不能为空。": "File path is required.",
  "无法注册内嵌浏览器 WebContents。": "Could not register the embedded browser.",
  "当前会话尚未打开内嵌浏览器。请先调用 browser_open。":
    "Open an embedded browser with browser_open first.",
  "GitHub 返回了无效的授权地址。": "GitHub returned an invalid authorization URL.",
  "GitHub 未返回有效的设备验证码，请重试。":
    "GitHub did not return a valid device code. Try again.",
  "GitHub 授权已过期，请重新连接。": "GitHub authorization expired. Reconnect to continue.",
  "GitHub 授权已取消。": "GitHub authorization was canceled.",
  "GitHub Token 不能为空。": "GitHub token is required.",
  "GitHub Token 验证失败，未返回用户信息。":
    "GitHub token validation failed: no user information returned.",
  "该 GitHub 写操作需要先连接 GitHub Token。":
    "Connect a GitHub token before this write operation.",
  "Agent 名称长度必须为 1 到 80 个字符。": "Agent names must contain 1 to 80 characters.",
  "Agent 描述不能超过 500 个字符。": "Agent descriptions cannot exceed 500 characters.",
  "Agent 指令不能超过 40,000 个字符。": "Agent instructions cannot exceed 40,000 characters.",
  "请选择一个扩展目录。": "Select an extension directory.",
  "目录或子目录中没有找到 SKILL.md 或 .codex-plugin/plugin.json。":
    "No SKILL.md or .codex-plugin/plugin.json found in this directory or its children.",
  "扩展总大小超过 64 MiB，已拒绝导入。": "Extension exceeds 64 MiB. Import was rejected.",
  "插件清单缺少 name。": "Plugin manifest is missing name.",
  "扩展不存在。": "Extension not found.",
  "无效的技能路径。": "Invalid skill path.",
  "技能市场中没有找到该技能，请刷新后重试。":
    "Skill not found in the marketplace. Refresh and retry.",
  "该技能目录没有任何可安装文件。": "This skill has no installable files.",
  "技能文件数量过多，已停止安装。": "Too many skill files. Installation stopped.",
  "技能大小超过 64 MiB，已停止安装。": "Skill exceeds 64 MiB. Installation stopped.",
  "技能路径越过了安装目录。": "Skill path escapes its installation directory.",
  "GitHub 技能目录过大，返回结果被截断。":
    "GitHub truncated this oversized skill directory listing.",
  "MCP 名称长度必须为 1 到 120 个字符。": "MCP names must contain 1 to 120 characters.",
  "stdio MCP 必须填写启动命令。": "A startup command is required for stdio MCP.",
  "HTTP MCP 必须填写有效的 http/https URL。": "Enter a valid HTTP(S) URL for the MCP server.",
  "OAuth 仅适用于远程 HTTP MCP Server。": "OAuth is available only for remote HTTP MCP servers.",
  "请先在 MCP 配置中启用 OAuth。": "Enable OAuth in this MCP configuration first.",
  "无法启动本地 OAuth 回调服务。": "Could not start the local OAuth callback service.",
  "OAuth Server 未提供动态客户端注册，请填写 Client ID。":
    "OAuth server does not offer dynamic registration. Enter a Client ID.",
  "OAuth 客户端注册未返回 client_id。": "OAuth registration returned no client_id.",
  "OAuth state 校验失败。": "OAuth state validation failed.",
  "OAuth 回调缺少 authorization code。": "OAuth callback is missing its authorization code.",
  "OAuth Token 响应缺少 access_token。": "OAuth token response is missing access_token.",
  "内置 MCP 不能删除，可以禁用或替换凭据。":
    "Built-in MCP servers cannot be deleted. Disable them or replace their credentials.",
  "未能发现 OAuth authorization/token endpoint。":
    "OAuth authorization or token endpoint discovery failed.",
  "MCP Server 不存在。": "MCP server not found.",
  "MCP server 不存在。": "MCP server not found.",
  "MCP Server 需要 OAuth 认证，请先在设置中完成授权。":
    "Complete OAuth authorization for this MCP server in Settings first.",
  "MCP 尚未配置必需的凭据或连接参数。":
    "Required MCP credentials or connection settings are missing.",
  "该 Claude 模型不支持关闭思考。": "This Claude model does not support disabling thinking.",
  "模型响应没有可读取的流。": "The model response has no readable stream.",
  "Anthropic 响应没有可读取的流。": "The Anthropic response has no readable stream.",
  "Responses 响应没有可读取的流。": "The Responses response has no readable stream.",
  "Chat Completions 响应没有可读取的流。": "The Chat Completions response has no readable stream.",
  "审批请求不存在或已经处理。": "Approval request was not found or has already been handled.",
  "问题不存在或已经回答。": "Question was not found or has already been answered.",
  "Base URL 不能为空。": "Base URL is required.",
  "Base URL 格式无效。": "Invalid Base URL.",
  "Base URL 只支持 HTTP 或 HTTPS。": "Base URL must use HTTP or HTTPS.",
  "Base URL 不能包含用户名或密码。": "Base URL cannot contain a username or password.",
  "Base URL 不能包含查询参数或锚点。": "Base URL cannot contain query parameters or a fragment.",
  "Base URL 必须以 /v1 结尾，例如 https://example.com/v1。":
    "Base URL must end in /v1, for example https://example.com/v1.",
  "自定义鉴权头名称无效。": "Invalid custom authentication header name.",
  "供应商名称长度必须为 1 到 80 个字符。": "Provider names must contain 1 to 80 characters.",
  "API Key 标签长度必须为 1 到 80 个字符。": "API key labels must contain 1 to 80 characters.",
  "Model ID 长度必须为 1 到 256 个字符。": "Model IDs must contain 1 to 256 characters.",
  "模型必须至少支持文字输入。": "Models must support text input.",
  "最大输出 token 不能超过上下文长度。": "Maximum output tokens cannot exceed the context window.",
  "创建供应商失败。": "Could not create provider.",
  "供应商不存在。": "Provider not found.",
  "API Key 不存在。": "API key not found.",
  "API Key 不属于该供应商。": "API key does not belong to this provider.",
  "API Key 不能为空。": "API key is required.",
  "该供应商没有可用的 API Key。": "No usable API key is configured for this provider.",
  "模型列表不是有效 JSON。": "Model list is not valid JSON.",
  "供应商返回的模型列表为空或格式不受支持。":
    "Provider returned an empty or unsupported model list.",
  "模型配置不存在或不属于该供应商。": "Model configuration was not found under this provider.",
  "模型配置不存在。": "Model configuration not found.",
  "定时间隔必须是 1 到 10080 分钟之间的整数。":
    "Task interval must be an integer from 1 to 10080 minutes.",
  "定时任务关联的会话不存在。": "The scheduled task's conversation no longer exists.",
  "任务名称长度必须为 1 到 120 个字符。": "Task names must contain 1 to 120 characters.",
  "定时任务提示词不能为空。": "Scheduled task prompt is required.",
  "定时任务不存在。": "Scheduled task not found.",
  "系统凭据加密不可用，无法安全保存 API Key。":
    "Platform encryption is unavailable. API keys cannot be safely stored.",
  "系统凭据解密不可用。": "Platform credential decryption is unavailable.",
  "凭据不存在或已被删除。": "Credential was not found or was deleted.",
  "目标路径超出工作目录。": "Target path is outside the workspace.",
  "文件路径越界或指向 Git 元数据。": "File path escapes the workspace or points to Git metadata.",
  "文件路径经过符号链接或目录链接。": "File path passes through a symbolic link or junction.",
  "文件路径必须是绝对路径。": "An absolute file path is required.",
  "目标不是文件。": "Target is not a regular file.",
  "文件超过 2 MB，编辑器不直接打开。": "This file exceeds the editor's 2 MB limit.",
  "二进制文件不能作为文本编辑。请使用对应应用，Office/PDF 文档可使用文档读取工具查看。":
    "Binary files cannot be edited as text. Use the appropriate application; Office/PDF documents can be opened with the document-reading tool.",
  "二进制文件不能作为文本编辑。": "Binary files cannot be edited as text.",
  "目标不是普通文件。若选择了目录，请先在文件列表中选择具体文件。":
    "The target is not a regular file. Select a file from the file list before opening it.",
  "目标不是普通文件或目录，请选择工作目录中的文件或目录。":
    "The target is not a regular file or folder. Select a file or folder in the workspace.",
  "找不到路径：": "Path not found: ",
  "。请检查文件或目录是否存在。": ". Check that the file or folder exists.",
  "路径中的某一项是文件，不能作为目录打开：":
    "A path component is a file and cannot be opened as a folder: ",
  "。请检查路径。": ". Check the path.",
  "工作区可快照文件超过 1 GiB，无法创建完整文件快照。": "Workspace snapshot content exceeds 1 GiB.",
  "快照存储目录不能位于工作区内部。": "Snapshot storage cannot be inside the workspace.",
  "快照期间文件增长超过 1 GiB。": "Snapshot content grew beyond 1 GiB while copying.",
  "快照路径无效。": "Invalid snapshot path.",
  "快照不存在或已损坏。": "Snapshot was not found or is damaged.",
  "快照与当前工作目录不匹配。": "Snapshot does not match this workspace.",
  "快照文件损坏。": "Snapshot file is damaged.",
  "快照 ID 无效。": "Invalid snapshot ID.",
  "当前没有可撤销的 Git 变更。": "No Git changes to discard.",
  "文件状态已变化，请刷新 Git 面板后重试。": "File state changed. Refresh the Git panel and retry.",
  "此仓库正在执行恢复操作。": "A recovery operation is already running for this repository.",
  "Git 文件路径无效。": "Invalid Git file path.",
  "Git 恢复备份超过 1 GiB，未执行撤销。":
    "Git recovery backup exceeds 1 GiB. No changes were discarded.",
  "Git 备份 ID 无效。": "Invalid Git backup ID.",
  "Git 备份与当前仓库不匹配。": "Git backup does not match this repository.",
  "Git 索引路径已变化。": "Git index path changed.",
  "仓库 HEAD 已变化，不能恢复旧暂存区，请从备份中提取文件。":
    "HEAD changed. Extract files from the backup instead of restoring the old index.",
  "Git 备份文件损坏。": "Git backup is damaged.",
  "恢复目标不是普通文件。": "Recovery target is not a regular file.",
  "恢复前的安全备份超过 1 GiB。": "The safety backup before recovery exceeds 1 GiB.",
  "worktree 含有未提交修改，不能删除。":
    "Worktree contains uncommitted changes and cannot be deleted.",
  "worktree 不属于此仓库。": "Worktree does not belong to this repository.",
  "操作已取消。": "Operation canceled.",
  "审批已取消。": "Approval canceled.",
  "请先移除附件，再执行聊天命令。": "Remove attachments before running a conversation command.",
  "当前没有可压缩的完整历史，请先完成一轮对话。":
    "No complete history to compact yet. Complete a conversation turn first.",
  "请等待当前任务完成或停止后再分支聊天。":
    "Wait for the current task to finish or stop it before forking.",
  "分支消息不存在或不属于当前会话。": "The fork message does not exist in this conversation.",
  "当前记录包含未完成的工具调用，请选择完整步骤后再分支。":
    "History contains unfinished tool calls. Choose a complete step before forking.",
};

export function localizeError(text: string, locale: unknown): string {
  if (locale !== "en") return text;
  let result = text;
  for (const [source, translated] of Object.entries(errors))
    result = result.replaceAll(source, translated);
  return result;
}
