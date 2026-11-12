import { n as hasClientEmbedding, t as recallL1Candidates } from "./chunk-ta3EaYLJ.js";
import { n as writeMemory, t as generateMemoryId } from "./chunk-CnWcW_21.js";
import { t as buildMemoryGenerationRefId } from "./chunk-Btt5RBuN.js";
// ../../third_party/tencentdb-agent-memory/src/core/prompts/l1-extraction.ts
const EXTRACT_MEMORIES_SYSTEM_PROMPT = `你是专业的"情境切分与记忆提取专家"。
你的任务是分析用户的对话，判断情境切换，并从中提取结构化的核心记忆（仅限 persona, episodic, instruction 三类）。

**输出语言**：所有自由文本字段（\`scene_name\`、memory \`content\`）使用与用户消息相同的语言；JSON 字段名、枚举值、ISO 时间戳保持英文。

### 任务一：情境切分（Scene Segmentation）
分析【待提取的新消息】，结合【上一个情境】，判断并输出当前对话的情境。
- 继承：无明显切换，沿用上一个情境。
- 切换条件：用户发出明确指令（如"换话题"）、意图转变、或提出独立新目标。
- 一段对话可能只有一个情境，也可能有多个情境（话题多次切换时）。
- 命名规则："我（AI）在和xxx（用户身份）做xxx（目标活动）"（**使用上述输出语言**，约 30-50 个字符或等价长度，单句，全局唯一）。

---

### 任务二：核心记忆提取（Memory Extraction）
结合背景和当前情境，仅从【待提取的新消息】中提取核心信息。

【通用提取原则】
1. 宁缺毋滥：过滤琐碎闲聊、临时性指令和一次性操作（如"这次、本单"）；剔除不可靠的边缘信息。
2. 独立完整：记忆必须"跳出当前对话依然成立"，无上下文也能看懂。提取主体必须以"用户（姓名）"或"AI"为核心。
3. 归纳合并：强关联或因果关系的多条消息，必须合并为一条完整记忆，不可碎片化。

【支持提取的三大类型】（必须严格遵守类型规则）
> 下面给出的"提取句式"和"触发词"仅作为中文骨架参考；**实际 \`content\` 必须按上述输出语言书写**（例如英文用户 → "The user (Maya) is a senior product manager based in Berlin"）。

1. 个性化记忆 (type: "persona")
   - 定义：用户的稳定属性、偏好、技能、价值观、习惯（如住所、职业、饮食禁忌）。
   - 提取句式："用户（[姓名]）喜欢/是/擅长..."
   - 打分 (priority)：80-100（健康/禁忌/核心特质）；50-70（一般喜好/技能）；<50（模糊次要，可丢弃）。
   - 触发词：喜欢、习惯、经常、我这个人...

2. 客观事件记忆 (type: "episodic")
   - 定义：客观发生的动作、决定、计划或达成结果。绝不包含纯主观感受。
   - 提取句式："用户（[姓名]）在 [最好是精确绝对时间] 于 [地点] [做了某事（可以包含起因、经过、结果）]"。
   - 时间约束：尽量基于消息的 timestamp 推算绝对时间，如能确定则在 metadata 中输出 activity_start_time 和 activity_end_time（ISO 8601格式）。无法确定时可省略。
   - 打分 (priority)：80-100（重要事件/计划）；60-70（一般完整活动）；<60（琐碎事项，直接丢弃）。

3. 全局指令记忆 (type: "instruction")
   - 定义：用户对 AI 提出的长期行为规则、格式偏好、语气控制。
   - 提取句式："用户要求/希望 AI 以后回答时..."
   - 触发词：以后都、从现在开始、记住、必须。
   - 打分 (priority)：-1（极其严格的全局死命令）；90-100（核心行为规则）；70-80（重要要求）；<70（临时要求，直接丢弃）。

---

### 不应该提取的内容
- 琐碎闲聊、问候；临时性的纯工具性请求（如"这次帮我翻译一下"）
- 一次性操作指令（如"这次、本单"相关）
- 重复的内容；AI助手自身的行为或输出
- 不属于以上3类的信息
- 纯主观感受（不带客观事件的情绪表达）

---

### 任务三：输出格式规范（JSON）
返回且仅返回一个合法的 JSON 数组。数组的每一项是一个情境，包含该情境的消息范围和抽取到的记忆：

[
  {
    "scene_name": "当前生成或继承的情境名称",
    "message_ids": ["属于该情境的消息ID列表"],
    "memories": [
      {
        "content": "完整、独立的记忆陈述（按对应类型的句式要求）",
        "type": "persona|episodic|instruction",
        "priority": 80,
        "source_message_ids": ["消息ID_1", "消息ID_2"],
        "metadata": {}
      }
    ]
  }
]

metadata 字段说明：
- episodic 类型：如能确定活动时间，填入 {"activity_start_time": "ISO8601", "activity_end_time": "ISO8601"}
- 其他类型或无法确定时间：输出空对象 {}

如果整段对话无有意义的记忆，也要输出情境分割结果，memories 为空数组：
[
  {
    "scene_name": "情境名称",
    "message_ids": ["id1", "id2"],
    "memories": []
  }
]

请严格按上述 JSON 数组格式输出，不要输出任何额外的 Markdown 代码块修饰符（如 \`\`\`json）或解释文本。`;
/**
* Format the user prompt for L1 extraction.
*
* @param newMessages - Messages to extract memories from (with ids and timestamps)
* @param backgroundMessages - Previous messages for context only (not for extraction)
* @param previousSceneName - The last known scene name (for continuity)
*/
function formatExtractionPrompt(params) {
	const { newMessages, backgroundMessages = [], previousSceneName = "无" } = params;
	return `**输出语言**：根据下方"待提取的新消息"中 user 发言的主导语言书写 \`scene_name\` 和 memory \`content\`。

【上一个情境】：${previousSceneName}

【背景对话】（仅供理解上下文推断关系/时间，严禁从中提取记忆）：
${backgroundMessages.length > 0 ? backgroundMessages.map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`).join("\n\n") : "无"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【待提取的新消息】（务必结合 timestamp 推算时间，只从这里提取记忆！）：
${newMessages.map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`).join("\n\n")}`;
}
// ../../third_party/tencentdb-agent-memory/adapters/generic-l1-extraction.js
function getExtractMemoriesSystemPrompt() {
	return EXTRACT_MEMORIES_SYSTEM_PROMPT;
}
// ../../third_party/tencentdb-agent-memory/src/core/prompts/l1-dedup.ts
const CONFLICT_DETECTION_SYSTEM_PROMPT = `你是记忆冲突检测器。批量比较多条【新记忆】与【统一候选记忆池】中的已有记忆，逐条决定如何处理。

**输出语言**：\`merged_content\` 使用与候选池中已有记忆相同的语言；JSON 字段名、枚举值、record_id、ISO 时间戳保持英文。

## 核心规则

- **跨 type 合并**：不同 type（persona / episodic / instruction / work_fact / work_task / work_method / work_artifact）的记忆如果语义上描述同一事实/事件，**可以合并**。
- **多对多合并**：一条新记忆可以同时替换/合并候选池中的**多条**已有记忆（通过 target_ids 数组指定）。
- 合并后你必须判断新记忆的最佳 type（merged_type）。

## 判断逻辑

1. **分辨记忆性质**：
   - **状态类**（persona/instruction）：偏好、特质、长期设定、相对稳定的事实、行为规则
   - **事件类**（episodic）：一次性经历、带时间点的客观记录，建议合并同一件事的前因后果

2. **判断是否同一事实/事件**：主体相同、主题一致、时间接近、scene_name 相似

3. **选择动作**：
   - "store"：视为新信息，新增当前记忆。
   - "skip"：已有记忆更好，新记忆无增量或更模糊，忽略当前记忆。
   - "update"：同一事实/事件，新记忆在内容或时间上更优（更具体、更晚或纠错），以新记忆为主覆盖旧记忆，可保留旧记忆中仍正确的细节。
   - "merge"：同一事实或同一演化过程，多条记忆信息互补且不矛盾，合并成一条更完整记忆，信息尽量不冗余。

4. **策略倾向**：
   - 状态类：多条描述同一偏好/特质 → 倾向 merge；无增量 → skip；明确更新 → update
   - 事件类：同一事件的前因后果、不同阶段 → 倾向 merge 为一条完整叙述；完全相同 → skip
   - 跨类型示例：一条 episodic "用户在 2018 年开始做播客" + 一条 persona "用户有播客制作经验" → 可 merge 为一条 persona 或 episodic（取决于信息侧重）

5. **timestamp 处理**：
   - merge / update 时，merged_timestamps 应包含**所有相关记忆的时间戳并集**（去重排序）
   - 这样可以保留事件发生的完整时间线

## 输出格式

严格输出 JSON 数组，每个元素对应一条新记忆的决策。不输出任何其他内容：

[
  {
    "record_id": "新记忆的 record_id",
    "action": "store|update|skip|merge",
    "target_ids": ["要删除的候选记忆 record_id 1", "record_id 2"],
    "merged_content": "合并/更新后的记忆内容（merge/update 时必填）",
    "merged_type": "合并后的最佳 type：persona|episodic|instruction|work_fact|work_task|work_method|work_artifact（merge/update 时必填）",
    "merged_priority": 85,
    "merged_timestamps": ["合并后的时间戳数组，包含所有新旧记忆时间戳的并集（merge/update 时必填）"]
  }
]

字段说明：
- target_ids：要删除替换的旧记忆 ID **数组**（可以 1 条或多条）。store/skip 时省略或为空。
- merged_content：merge/update 时的最终记忆文本。store/skip 时省略。
- merged_type：merge/update 后记忆应归属的 type。根据合并后内容本质判断。
- merged_priority：merge/update 后的新优先级（0-100 整数，merge/update 时必填）。合并后信息更完整、更确定，通常应**酌情提升** priority（例如两条 priority 70 的记忆合并后可提升到 80）。参考标准：80-100（核心特质/重要事件），60-79（一般偏好/普通活动），<60（次要信息）。
- merged_timestamps：合并后的时间戳数组。收集新记忆 + 所有被合并旧记忆的时间戳，去重排序。`;
/**
* Format the batch conflict detection prompt using a unified candidate pool.
*
* Format (aligned with prototype):
* 1. Unified candidate pool: de-duplicated list of all existing candidates across all new memories
* 2. Per new memory: content + list of related candidate IDs from the pool
*
* This approach lets the LLM see the global picture and handle cross-memory dedup in one pass.
*
* @param matches - Array of new memories with their candidate matches
*/
function formatBatchConflictPrompt(matches) {
	const unifiedPool = /* @__PURE__ */ new Map();
	const perMemoryCandidateIds = /* @__PURE__ */ new Map();
	for (const m of matches) {
		const candidateIds = [];
		for (const c of m.candidates) {
			if (!unifiedPool.has(c.id)) unifiedPool.set(c.id, c);
			candidateIds.push(c.id);
		}
		perMemoryCandidateIds.set(m.newMemory.record_id, candidateIds);
	}
	const poolList = Array.from(unifiedPool.values()).map((c) => ({
		record_id: c.id,
		content: c.content,
		type: c.type,
		priority: c.priority,
		scene_name: c.scene_name,
		timestamps: c.timestamps
	}));
	let poolSection;
	if (poolList.length === 0) poolSection = "## 统一候选记忆池\n\n（空，没有已有记忆，所有新记忆直接 store）";
	else {
		const poolStr = JSON.stringify(poolList, null, 2);
		poolSection = `## 统一候选记忆池（共 ${poolList.length} 条已有记忆）\n\n${poolStr}`;
	}
	const newMemoriesText = matches.map((m, idx) => {
		const relatedIds = perMemoryCandidateIds.get(m.newMemory.record_id) ?? [];
		const relatedNote = relatedIds.length > 0 ? JSON.stringify(relatedIds) : "[]（无相似候选，直接 store）";
		const memStr = JSON.stringify({
			record_id: m.newMemory.record_id,
			content: m.newMemory.content,
			type: m.newMemory.type,
			priority: m.newMemory.priority,
			scene_name: m.newMemory.scene_name
		}, null, 2);
		return `### 第 ${idx + 1} 条新记忆 (record_id: ${m.newMemory.record_id})\n${memStr}\n\n【关联候选 ID】${relatedNote}`;
	}).join("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");
	return `**输出语言**：\`merged_content\` 使用与候选池中已有记忆相同的语言。

${poolSection}

${"═".repeat(50)}

## 待判断的新记忆（共 ${matches.length} 条）

${newMemoriesText}

请逐条判断并输出决策 JSON 数组。当某条新记忆的候选列表为空时，该条直接输出 action=store。`;
}
// ../../third_party/tencentdb-agent-memory/adapters/generic-l1-dedup.js
function getConflictDetectionSystemPrompt() {
	return CONFLICT_DETECTION_SYSTEM_PROMPT;
}
// resources/tencentdb-memory/upstream/adapters/disabled-runner.js
var CleanContextRunner = class {
	constructor() {
		throw new Error("Harness must supply its own memory model runner. OpenClaw is disabled.");
	}
};
// ../../third_party/tencentdb-agent-memory/src/utils/sanitize.ts
/**
* L0 capture filter — intentionally **permissive**.
*
* L0 is the raw conversation archive. We want to preserve as much user input
* as possible so that downstream stages (L1 extraction, search, analytics)
* have the full picture. Only messages that are *structurally* useless are
* dropped here:
*   - Empty / whitespace-only text
*   - Framework-internal noise (bootstrap, session reset, NO_REPLY, …)
*   - Slash commands (/new, /reset, …)
*
* Content-quality filters (length, symbols, prompt injection) are deferred
* to {@link shouldExtractL1}.
*/
function shouldCaptureL0(text) {
	if (!text || !text.trim()) return false;
	if (isFrameworkNoise(text)) return false;
	if (text.startsWith("/")) return false;
	return true;
}
/**
* L1 extraction filter — **strict** quality gate.
*
* Applied when L0 messages are fed into the LLM extraction pipeline.
* Filters out content that is too short, too long, purely symbolic,
* or looks like a prompt-injection attack — none of which should
* become structured memories.
*
* This function is a superset of {@link shouldCaptureL0}: anything
* rejected by L0 is also rejected here, plus additional quality checks.
*/
function shouldExtractL1(text) {
	if (!shouldCaptureL0(text)) return false;
	if (/^[^\w\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]{1,5}$/.test(text)) return false;
	if (/^[?？]+$/.test(text)) return false;
	return true;
}
/**
* Detect framework-injected noise messages that should never be captured.
*
* These include:
* - "(session bootstrap)" — synthetic user turn for Google turn-order compliance
* - Session startup instructions from /new or /reset
* - "✅ New session started" — AI's ack of session startup (no user-meaningful content)
* - Pre-compaction memory flush prompts (system-to-agent instructions, not user content)
* - AI's NO_REPLY ack of memory flush (no user-meaningful content)
*/
function isFrameworkNoise(text) {
	const t = text.trim();
	if (t === "(session bootstrap)") return true;
	if (t.startsWith("A new session was started via")) return true;
	if (/^✅\s*New session started/.test(t)) return true;
	if (t.startsWith("Pre-compaction memory flush")) return true;
	if (/^NO_REPLY\s*$/.test(t)) return true;
	return false;
}
/**
* Sanitize a raw JSON string from LLM output so that `JSON.parse` won't throw
* "Bad control character in string literal".
*
* Per RFC 8259 §7, U+0000–U+001F MUST be escaped inside JSON string literals.
* LLMs sometimes produce unescaped control characters (raw newlines, tabs, etc.)
* inside string values.
*
* Strategy (two-phase):
*  1. **Precise pass** — walk through JSON string literals (delimited by `"`)
*     and escape any unescaped U+0000–U+001F inside them to `\uXXXX` form,
*     while leaving structural whitespace (between values) untouched.
*  2. **Fallback** — if the precise pass still fails `JSON.parse`, fall back to
*     a simple global strip of rare control chars (\x00–\x08, \x0b, \x0c,
*     \x0e–\x1f) which are almost never meaningful in natural-language content.
*/
function sanitizeJsonForParse(raw) {
	const escaped = escapeControlCharsInJsonStrings(raw);
	try {
		JSON.parse(escaped);
		return escaped;
	} catch {}
	return escaped.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
/**
* Walk through a JSON text and escape U+0000–U+001F control characters that
* appear *inside* JSON string literals (between unescaped `"` delimiters).
*
* Characters that already have short escape sequences (\n, \r, \t, \b, \f)
* are mapped to those; others become \uXXXX.
*
* Structural whitespace outside string literals is left untouched.
*/
function escapeControlCharsInJsonStrings(text) {
	const SHORT_ESCAPES = {
		8: "\\b",
		9: "\\t",
		10: "\\n",
		12: "\\f",
		13: "\\r"
	};
	const out = [];
	let inString = false;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		const code = ch.charCodeAt(0);
		if (inString) {
			if (ch === "\\" && i + 1 < text.length) {
				out.push(ch, text[i + 1]);
				i += 2;
				continue;
			}
			if (ch === "\"") {
				out.push(ch);
				inString = false;
				i++;
				continue;
			}
			if (code <= 31) {
				const short = SHORT_ESCAPES[code];
				if (short) out.push(short);
				else out.push("\\u" + code.toString(16).padStart(4, "0"));
				i++;
				continue;
			}
			out.push(ch);
			i++;
		} else {
			if (ch === "\"") {
				out.push(ch);
				inString = true;
				i++;
				continue;
			}
			out.push(ch);
			i++;
		}
	}
	return out.join("");
}
// ../../third_party/tencentdb-agent-memory/src/core/types.ts
/**
* 把 TraceContext 展平进 LLMRunParams 的 langfuse 三字段。
*   - traceName: 传业务锚点（如 "memory.l1-extract"）
*   - userId:    langfuse 顶级 userId 列
*   - sessionId: langfuse 顶级 sessionId 列
*   - tags:      ["team:<id>", "agent:<id>"] 便于侧栏筛选
* 三者结合后 langfuse UI 上一眼能定位某个 (user, agent, session) 的 trace 组。
*/
function buildTraceParams(traceName, ctx) {
	const out = { traceName };
	if (ctx?.userId) out.userId = ctx.userId;
	if (ctx?.sessionId) out.sessionId = ctx.sessionId;
	const tags = [];
	if (ctx?.teamId) tags.push(`team:${ctx.teamId}`);
	if (ctx?.agentId) tags.push(`agent:${ctx.agentId}`);
	if (tags.length > 0) out.tags = tags;
	return out;
}
// ../../third_party/tencentdb-agent-memory/src/core/record/l1-dedup.ts
const TAG$1 = "[memory-tdai][l1-dedup]";
/**
* Batch conflict detection: compare all new memories against existing records
* in a single LLM call.
*
* Candidate recall strategy:
* 1. Native hybrid (TCVDB dense+sparse) when the store advertises it
* 2. Otherwise FTS ∥ client-vector in parallel, RRF-merged (same as memory_search)
* 3. Skip conflict detection entirely — all memories go straight to "store"
*
* Isolation is the caller's `filter` (production extraction is session-scoped).
* Do not reuse search's cross-session isolation here.
*
* @param memories - Newly extracted memories (with record_id)
* @param config - OpenClaw config (for LLM access)
* @param logger - Optional logger
* @param model - Optional model override
* @param vectorStore - Optional vector store for candidate recall
* @param embeddingService - Optional embedding service for computing query vectors
* @param conflictRecallTopK - Top-K candidates to recall per new memory (default: 5)
* @returns Array of dedup decisions, one per new memory
*/
async function batchDedup(params) {
	const { memories, config, logger, model, promptMode = "chat", vectorStore, embeddingService, llmRunner, filter, traceContext } = params;
	const topK = params.conflictRecallTopK ?? 5;
	if (memories.length === 0) return [];
	const storeAll = () => memories.map((m) => ({
		record_id: m.record_id,
		action: "store",
		target_ids: []
	}));
	const hasVectorData = vectorStore && await vectorStore.countL1() > 0;
	const hasFts = vectorStore?.isFtsAvailable() ?? false;
	const nativeHybrid = !!(vectorStore && typeof vectorStore.getCapabilities === "function" && vectorStore.getCapabilities().nativeHybridSearch && typeof vectorStore.searchL1Hybrid === "function");
	if (!hasVectorData && !hasFts && !nativeHybrid) {
		logger?.debug?.(`${TAG$1} No vector data and no FTS available, skipping conflict detection for ${memories.length} memories`);
		return storeAll();
	}
	const vectorCapable = (typeof vectorStore?.getCapabilities === "function" ? vectorStore.getCapabilities().vectorSearch : void 0) ?? true;
	logger?.debug?.(`${TAG$1} Using hybrid candidate recall (topK=${topK})`);
	const matches = await findCandidates(memories, vectorStore, vectorCapable ? embeddingService : void 0, topK, logger, params.embeddingTimeoutMs, filter, hasVectorData);
	if (!matches.some((m) => m.candidates.length > 0)) {
		logger?.debug?.(`${TAG$1} No similar records found for any memory, all will be stored`);
		return storeAll();
	}
	return runLlmJudgment(matches, memories, config, logger, model, promptMode, llmRunner, traceContext);
}
/**
* Phase 2: Run batch LLM judgment on candidate matches.
*/
async function runLlmJudgment(matches, memories, config, logger, model, promptMode, llmRunner, traceContext) {
	logger?.debug?.(`${TAG$1} Running batch conflict detection for ${memories.length} memories (promptMode=${promptMode})`);
	try {
		const userPrompt = formatBatchConflictPrompt(matches);
		const systemPrompt = getConflictDetectionSystemPrompt(promptMode);
		let result;
		const traceParams = buildTraceParams("memory.l1-dedup", traceContext);
		if (llmRunner) result = await llmRunner.run({
			prompt: userPrompt,
			systemPrompt,
			taskId: "l1-conflict-detection",
			timeoutMs: 18e4,
			...traceParams
		});
		else result = await new CleanContextRunner({
			config,
			modelRef: model,
			enableTools: false,
			logger
		}).run({
			prompt: userPrompt,
			systemPrompt,
			taskId: "l1-conflict-detection",
			timeoutMs: 18e4,
			...traceParams
		});
		return parseBatchResult(result, memories, logger);
	} catch (err) {
		logger?.warn?.(`${TAG$1} Batch conflict detection failed, defaulting all to store: ${err instanceof Error ? err.message : String(err)}`);
		return memories.map((m) => ({
			record_id: m.record_id,
			action: "store",
			target_ids: []
		}));
	}
}
function hitToMemoryRecord(r) {
	return {
		id: r.record_id,
		content: r.content,
		type: r.type,
		priority: r.priority,
		scene_name: r.scene_name,
		source_message_ids: [],
		metadata: r.metadata_json ? (() => {
			try {
				return JSON.parse(r.metadata_json);
			} catch {
				return {};
			}
		})() : {},
		timestamps: [r.timestamp_str].filter(Boolean),
		createdAt: "",
		updatedAt: "",
		sessionKey: r.session_key,
		sessionId: r.session_id
	};
}
/**
* Hybrid candidate recall (aligned with memory_search):
* batch-embed when a client embedder exists, then per-memory recallL1Candidates
* (native hybrid, else FTS ∥ vector + RRF). Exclude self-batch IDs afterwards.
*/
async function findCandidates(memories, vectorStore, embeddingService, topK, logger, embeddingTimeoutMs, filter, hasVectorData) {
	const newRecordIds = new Set(memories.map((m) => m.record_id));
	const nativeHybrid = !!(typeof vectorStore.getCapabilities === "function" && vectorStore.getCapabilities().nativeHybridSearch && typeof vectorStore.searchL1Hybrid === "function");
	let queryEmbeddings;
	let vectorSvc = embeddingService;
	if (hasClientEmbedding(embeddingService) && !nativeHybrid) {
		if (hasVectorData) try {
			queryEmbeddings = await embeddingService.embedBatch(memories.map((m) => m.content), embeddingTimeoutMs ? { timeoutMs: embeddingTimeoutMs } : void 0);
		} catch (err) {
			logger?.warn?.(`${TAG$1} embedBatch failed (non-fatal, FTS may still run): ${err instanceof Error ? err.message : String(err)}`);
			vectorSvc = void 0;
		}
		else vectorSvc = void 0;
	}
	const recallTopK = topK + memories.length;
	const matches = [];
	for (let i = 0; i < memories.length; i++) {
		const mem = memories[i];
		const candidates = (await recallL1Candidates({
			query: mem.content,
			topK: recallTopK,
			vectorStore,
			embeddingService: vectorSvc,
			logger,
			filter,
			queryEmbedding: queryEmbeddings?.[i],
			embeddingTimeoutMs,
			logTag: TAG$1
		})).hits.filter((r) => !newRecordIds.has(r.record_id)).slice(0, topK).map(hitToMemoryRecord);
		matches.push({
			newMemory: mem,
			candidates
		});
	}
	logger?.debug?.(`${TAG$1} Candidate recall: ${matches.map((m) => `${m.newMemory.record_id}→${m.candidates.length}`).join(", ")}`);
	return matches;
}
const VALID_TYPES$1 = [
	"persona",
	"episodic",
	"instruction",
	"work_fact",
	"work_task",
	"work_method",
	"work_artifact"
];
/**
* Parse the LLM's batch conflict detection JSON response.
*
* Expected format: [{record_id, action, target_ids, merged_content, merged_type, merged_priority, merged_timestamps}]
*/
function parseBatchResult(raw, memories, logger) {
	try {
		let cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
		if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
		const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
		if (!arrayMatch) {
			logger?.warn?.(`${TAG$1} No JSON array found in conflict detection response`);
			return fallbackStoreAll(memories);
		}
		const sanitized = sanitizeJsonForParse(arrayMatch[0]);
		const parsed = JSON.parse(sanitized);
		if (!Array.isArray(parsed)) {
			logger?.warn?.(`${TAG$1} Conflict detection response is not an array`);
			return fallbackStoreAll(memories);
		}
		const decisions = [];
		const validActions = [
			"store",
			"update",
			"merge",
			"skip"
		];
		for (const item of parsed) {
			if (!item || typeof item !== "object") continue;
			const d = item;
			const recordId = String(d.record_id ?? "");
			if (!recordId) {
				logger?.debug?.(`${TAG$1} Skipping decision with empty record_id`);
				continue;
			}
			const action = String(d.action ?? "store");
			if (!validActions.includes(action)) logger?.warn?.(`${TAG$1} Invalid action "${action}" for record ${recordId}, defaulting to store`);
			decisions.push({
				record_id: recordId,
				action: validActions.includes(action) ? action : "store",
				target_ids: Array.isArray(d.target_ids) ? d.target_ids.map(String) : [],
				merged_content: typeof d.merged_content === "string" ? d.merged_content : void 0,
				merged_type: VALID_TYPES$1.includes(d.merged_type) ? d.merged_type : void 0,
				merged_priority: typeof d.merged_priority === "number" ? d.merged_priority : void 0,
				merged_timestamps: Array.isArray(d.merged_timestamps) ? d.merged_timestamps.map(String) : void 0
			});
		}
		const decidedIds = new Set(decisions.map((d) => d.record_id));
		for (const mem of memories) if (!decidedIds.has(mem.record_id)) {
			logger?.debug?.(`${TAG$1} No decision for record ${mem.record_id}, defaulting to store`);
			decisions.push({
				record_id: mem.record_id,
				action: "store",
				target_ids: []
			});
		}
		return decisions;
	} catch (err) {
		logger?.warn?.(`${TAG$1} Failed to parse conflict detection result: ${err instanceof Error ? err.message : String(err)}`);
		return fallbackStoreAll(memories);
	}
}
/**
* Fallback: store all memories when parsing fails.
*/
function fallbackStoreAll(memories) {
	return memories.map((m) => ({
		record_id: m.record_id,
		action: "store",
		target_ids: []
	}));
}
var MemoryGenerationLogStore = class {
	async write() {}
};
function buildGenerationLogIdentity(layer, time, anchor) {
	const id = `local-${layer}-${time}-${anchor || "none"}`;
	return {
		generationId: id,
		logId: id,
		key: id
	};
}
function buildGenerationProvenance(identity, prompt) {
	return {
		generation_id: identity.generationId,
		prompt
	};
}
function buildPromptGenerationRef() {
	return {
		memory_prompt_id: "builtin:l1",
		version: 1,
		source: "system",
		prompt_sha256: ""
	};
}
async function writeGenerationProvenanceBestEffort() {}
const metricProducer = { send() {} };
// ../../third_party/tencentdb-agent-memory/adapters/disabled-storage.mjs
var StorageAdapter = class {
	constructor() {
		throw new Error("Harness project memory snapshot storage is required.");
	}
};
var LocalStorageBackend = class extends StorageAdapter {};
// ../../third_party/tencentdb-agent-memory/src/core/memory-prompt/composer.ts
const GUARDS = {
	l1: `自定义内容仅用于调整应关注、忽略和归纳的记忆内容。
不得修改当前系统 Prompt 的 JSON 格式、字段、类型枚举、消息来源边界，
也不得要求输出 Markdown、解释文本或额外字段；冲突时以系统约束为准。`,
	l2: `自定义内容仅用于调整 Scene 的关注点、分类和归纳策略。
不得修改当前系统 Prompt 的 Scene Markdown/META 协议、工具白名单、
文件命名、读写范围、沙箱、数量和长度限制；冲突时以系统约束为准。`,
	l3: `自定义内容仅用于调整 Persona 或 Team Doctrine 的提炼关注点。
不得修改当前系统 Prompt 的 persona.md 目标、文件工具和路径范围、
证据来源、固定 Markdown 协议及长度限制；冲突时以系统约束为准。`
};
function escapeClosingTags(value) {
	return value.replace(/<\/(CUSTOM_MEMORY_STRATEGY|SYSTEM_CUSTOM_STRATEGY_GUARD)>/gi, "&lt;/$1&gt;");
}
/**
* Preserve the existing system prompt byte-for-byte when no custom prompt is
* resolved. A custom strategy is appended only for agent/team/instance hits.
*/
function composeMemorySystemPrompt(currentSystemPrompt, resolved) {
	if (!resolved || resolved.source === "system" || !resolved.prompt.trim()) return currentSystemPrompt;
	const custom = escapeClosingTags(resolved.prompt.trim());
	return `${currentSystemPrompt}

<CUSTOM_MEMORY_STRATEGY source="${resolved.source}" memory_prompt_id="${resolved.memory_prompt_id}" version="${resolved.version}" layer="${resolved.layer}">
${custom}
</CUSTOM_MEMORY_STRATEGY>

<SYSTEM_CUSTOM_STRATEGY_GUARD priority="highest">
${GUARDS[resolved.layer]}
</SYSTEM_CUSTOM_STRATEGY_GUARD>`;
}
// ../../third_party/tencentdb-agent-memory/src/core/record/l1-extractor.ts
const TAG = "[memory-tdai][l1-extractor]";
/**
* Run the full L1 extraction pipeline on conversation messages.
*
* @param messages - Filtered conversation messages (from L0 or directly from hook)
* @param sessionKey - The session key
* @param baseDir - Base data directory (~/.openclaw/memory-tdai/)
* @param config - OpenClaw config (for LLM access)
* @param options - Extraction options
* @param logger - Optional logger
*/
async function extractL1Memories(params) {
	const { messages, sessionKey, sessionId, taskId, teamId, userId, agentId, baseDir, config, logger, instanceId: metricInstanceId, storage } = params;
	const options = params.options ?? {};
	const maxNewMessages = options.maxMessagesPerExtraction ?? 10;
	const maxBgMessages = options.maxBackgroundMessages ?? 5;
	const enableDedup = options.enableDedup ?? true;
	const maxMemoriesPerSession = options.maxMemoriesPerSession ?? 10;
	if (messages.length === 0) {
		logger?.debug?.(`${TAG} No messages to extract from`);
		return {
			success: true,
			extractedCount: 0,
			storedCount: 0,
			records: [],
			sceneNames: []
		};
	}
	const l1StartMs = Date.now();
	const qualifiedMessages = messages.filter((m) => shouldExtractL1(m.content));
	if (qualifiedMessages.length < messages.length) logger?.debug?.(`${TAG} L1 quality filter: ${messages.length} → ${qualifiedMessages.length} messages (${messages.length - qualifiedMessages.length} filtered out)`);
	if (qualifiedMessages.length === 0) {
		logger?.debug?.(`${TAG} All messages filtered out by L1 quality gate`);
		return {
			success: true,
			extractedCount: 0,
			storedCount: 0,
			records: [],
			sceneNames: []
		};
	}
	const newMessages = qualifiedMessages.slice(-maxNewMessages);
	const bgEndIdx = qualifiedMessages.length - newMessages.length;
	const backgroundMessages = bgEndIdx > 0 ? qualifiedMessages.slice(Math.max(0, bgEndIdx - maxBgMessages), bgEndIdx) : [];
	logger?.debug?.(`${TAG} Extracting from ${newMessages.length} new messages (+ ${backgroundMessages.length} background) [${qualifiedMessages.length} qualified from ${messages.length} input]`);
	let scenes;
	let earlyEmptyReason;
	try {
		const outcome = await callLlmExtraction({
			newMessages,
			backgroundMessages,
			previousSceneName: options.previousSceneName,
			config,
			logger,
			model: options.model,
			promptMode: options.promptMode,
			memoryPrompt: options.memoryPrompt,
			traceContext: {
				teamId,
				userId,
				agentId,
				sessionId
			},
			llmRunner: options.llmRunner
		});
		scenes = outcome.scenes;
		earlyEmptyReason = outcome.emptyReason;
		logger?.debug?.(`${TAG} LLM detected ${scenes.length} scene(s)`);
	} catch (err) {
		logger?.error(`${TAG} LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`);
		logger?.warn?.(`${TAG} l1-empty reason=llm_error sessionKey=${sessionKey} msg=${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}`);
		return {
			success: false,
			extractedCount: 0,
			storedCount: 0,
			records: [],
			sceneNames: []
		};
	}
	const allExtracted = [];
	const sceneNames = [];
	for (const scene of scenes) {
		sceneNames.push(scene.scene_name);
		for (const mem of scene.memories) {
			const memType = normalizeType(mem.type);
			if (!memType) {
				logger?.warn?.(`${TAG} Skipping memory with invalid type "${mem.type}"`);
				continue;
			}
			allExtracted.push({
				content: mem.content,
				type: memType,
				priority: typeof mem.priority === "number" ? mem.priority : 50,
				source_message_ids: Array.isArray(mem.source_message_ids) ? mem.source_message_ids : [],
				metadata: mem.metadata ?? {},
				scene_name: scene.scene_name
			});
		}
	}
	logger?.debug?.(`${TAG} Total extracted memories: ${allExtracted.length} across ${scenes.length} scene(s)`);
	if (allExtracted.length === 0) {
		const finalReason = earlyEmptyReason ?? (scenes.length > 0 ? "normalized_all_dropped" : "empty_scenes");
		logger?.warn?.(`${TAG} l1-empty reason=${finalReason} sessionKey=${sessionKey} scenes=${scenes.length} inputMsgs=${messages.length}`);
		if (metricInstanceId) try {
			const l0Count = messages.length;
			metricProducer.send({
				metric: "l0_input_count",
				instanceId: metricInstanceId,
				value: l0Count,
				source: "core"
			});
			metricProducer.send({
				metric: "l1_extracted_count",
				instanceId: metricInstanceId,
				value: 0,
				source: "core"
			});
			if (l0Count > 0) metricProducer.send({
				metric: "l1_extraction_rate",
				instanceId: metricInstanceId,
				value: 0,
				source: "core"
			});
		} catch {}
		return {
			success: true,
			extractedCount: 0,
			storedCount: 0,
			records: [],
			sceneNames,
			lastSceneName: sceneNames[sceneNames.length - 1]
		};
	}
	let extracted = allExtracted;
	if (extracted.length > maxMemoriesPerSession) {
		logger?.debug?.(`${TAG} Limiting from ${extracted.length} to ${maxMemoriesPerSession} memories per session`);
		extracted = extracted.slice(0, maxMemoriesPerSession);
	}
	const memoriesWithIds = extracted.map((m) => ({
		...m,
		record_id: generateMemoryId()
	}));
	let storedRecords;
	const generationFinishedAt = Date.now();
	const generationIdentity = buildGenerationLogIdentity("l1", generationFinishedAt, memoriesWithIds[0]?.record_id);
	const generationPrompt = buildPromptGenerationRef(options.memoryPrompt, "l1");
	const generation = buildGenerationProvenance(generationIdentity, generationPrompt);
	if (enableDedup) try {
		const dedupStartMs = Date.now();
		const decisions = await batchDedup({
			memories: memoriesWithIds,
			config,
			logger,
			model: options.model,
			promptMode: options.promptMode,
			vectorStore: options.vectorStore,
			embeddingService: options.embeddingService,
			conflictRecallTopK: options.conflictRecallTopK,
			embeddingTimeoutMs: options.embeddingTimeoutMs,
			llmRunner: options.llmRunner,
			traceContext: {
				teamId,
				userId,
				agentId,
				sessionId
			},
			...teamId || userId || agentId || sessionId || taskId ? { filter: {
				teamId,
				userId,
				agentId,
				sessionId,
				taskId
			} } : {}
		});
		Date.now() - dedupStartMs;
		if (metricInstanceId) try {
			const dedupCounts = {
				store: 0,
				update: 0,
				merge: 0,
				skip: 0
			};
			for (const d of decisions) if (d.action in dedupCounts) dedupCounts[d.action]++;
			metricProducer.send({
				metric: "l1_dedup_store_count",
				instanceId: metricInstanceId,
				value: dedupCounts.store,
				source: "core"
			});
			metricProducer.send({
				metric: "l1_dedup_update_count",
				instanceId: metricInstanceId,
				value: dedupCounts.update,
				source: "core"
			});
			metricProducer.send({
				metric: "l1_dedup_merge_count",
				instanceId: metricInstanceId,
				value: dedupCounts.merge,
				source: "core"
			});
			metricProducer.send({
				metric: "l1_dedup_skip_count",
				instanceId: metricInstanceId,
				value: dedupCounts.skip,
				source: "core"
			});
		} catch {}
		storedRecords = await applyDecisions({
			memoriesWithIds,
			decisions,
			baseDir,
			sessionKey,
			sessionId,
			taskId,
			teamId,
			userId,
			agentId,
			logger,
			vectorStore: options.vectorStore,
			embeddingService: options.embeddingService,
			storage
		});
	} catch (err) {
		logger?.warn?.(`${TAG} Batch dedup failed, storing all as new: ${err instanceof Error ? err.message : String(err)}`);
		storedRecords = await storeAllDirectly(memoriesWithIds, baseDir, sessionKey, sessionId, taskId, teamId, userId, agentId, logger, options.vectorStore, options.embeddingService, storage);
	}
	else storedRecords = await storeAllDirectly(memoriesWithIds, baseDir, sessionKey, sessionId, taskId, teamId, userId, agentId, logger, options.vectorStore, options.embeddingService, storage);
	const generationLogStore = new MemoryGenerationLogStore(storage ?? new StorageAdapter(new LocalStorageBackend(baseDir)), metricInstanceId ?? "standalone");
	const generationLog = {
		schema_version: 1,
		log_id: generationIdentity.logId,
		generation_id: generationIdentity.generationId,
		instance_id: metricInstanceId ?? "standalone",
		layer: "l1",
		status: "succeeded",
		team_id: teamId,
		agent_id: agentId,
		user_id: userId,
		session_id: sessionId,
		task_id: taskId,
		prompt: generationPrompt,
		anchor_memory_id: storedRecords[0]?.id ?? memoriesWithIds[0]?.record_id,
		input_refs: newMessages.map((message) => ({
			layer: "l0",
			record_id: message.id
		})),
		output_refs: storedRecords.map((record) => ({
			layer: "l1",
			record_id: record.id
		})),
		model: options.model,
		prompt_mode: options.promptMode ?? "chat",
		started_at_ms: l1StartMs,
		finished_at_ms: generationFinishedAt,
		latency_ms: generationFinishedAt - l1StartMs
	};
	await /* @__PURE__ */ writeGenerationProvenanceBestEffort({
		layer: "l1",
		logger,
		writeLog: () => generationLogStore.write(generationLog, generationIdentity.key),
		writeRefs: options.vectorStore?.upsertMemoryGenerationRefs && storedRecords.length > 0 ? () => options.vectorStore.upsertMemoryGenerationRefs(storedRecords.map((record) => ({
			generation_ref_id: buildMemoryGenerationRefId("l1", record.id),
			layer: "l1",
			memory_id: record.id,
			...generation,
			created_at_ms: generationFinishedAt
		}))) : void 0
	});
	logger?.info(`${TAG} Extraction complete: extracted=${extracted.length}, stored=${storedRecords.length}`);
	if (metricInstanceId && logger) {
		const memoriesByType = {};
		for (const r of storedRecords) memoriesByType[r.type] = (memoriesByType[r.type] ?? 0) + 1;
		messages.length, extracted.length, storedRecords.length, storedRecords.map((r) => ({
			content: r.content,
			type: r.type,
			scene: r.scene_name ?? null
		})), Date.now() - l1StartMs;
	}
	if (metricInstanceId) try {
		const l0Count = messages.length;
		const l1Count = extracted.length;
		metricProducer.send({
			metric: "l0_input_count",
			instanceId: metricInstanceId,
			value: l0Count,
			source: "core"
		});
		metricProducer.send({
			metric: "l1_extracted_count",
			instanceId: metricInstanceId,
			value: l1Count,
			source: "core"
		});
		if (l0Count > 0) metricProducer.send({
			metric: "l1_extraction_rate",
			instanceId: metricInstanceId,
			value: l1Count / l0Count,
			source: "core"
		});
	} catch {}
	try {
		Date.now() - l1StartMs;
	} catch {}
	return {
		success: true,
		extractedCount: extracted.length,
		storedCount: storedRecords.length,
		records: storedRecords,
		sceneNames,
		lastSceneName: sceneNames[sceneNames.length - 1]
	};
}
/**
* Call LLM to extract scene-segmented memories from conversation messages.
*/
async function callLlmExtraction(params) {
	const { newMessages, backgroundMessages, previousSceneName, config, logger, model, promptMode = "chat", memoryPrompt, llmRunner, traceContext } = params;
	const systemPrompt = composeMemorySystemPrompt(getExtractMemoriesSystemPrompt(promptMode), memoryPrompt);
	const userPrompt = formatExtractionPrompt({
		newMessages,
		backgroundMessages,
		previousSceneName
	});
	logger?.debug?.(`${TAG} [l1-debug] ENTRY taskId=l1-extraction, promptMode=${promptMode}, newMsgs=${newMessages.length}, bgMsgs=${backgroundMessages.length}, userPromptLen=${userPrompt.length}, sysPromptLen=${systemPrompt.length}, model=${model ?? "(default)"}, previousSceneName=${previousSceneName ? JSON.stringify(previousSceneName) : "(none)"}, runnerKind=${llmRunner ? "llmRunner" : "CleanContextRunner"}`);
	let result;
	const traceParams = buildTraceParams("memory.l1-extract", traceContext);
	if (llmRunner) result = await llmRunner.run({
		prompt: userPrompt,
		systemPrompt,
		taskId: "l1-extraction",
		timeoutMs: 18e4,
		...traceParams
	});
	else result = await new CleanContextRunner({
		config,
		modelRef: model,
		enableTools: false,
		logger
	}).run({
		prompt: userPrompt,
		systemPrompt,
		taskId: "l1-extraction",
		timeoutMs: 18e4,
		...traceParams
	});
	return parseExtractionResult(result, logger);
}
/**
* Parse the LLM's JSON response into SceneSegment array.
* Expected format: [{scene_name, message_ids, memories: [...]}]
*
* Diagnostics contract:
*   - Debug-level [l1-debug] lines dump raw content on NO_JSON / PARSE_FAIL
*     (unchanged from prior behavior).
*   - The returned `emptyReason` is the CANONICAL machine-readable label —
*     `extractL1Memories` uses it to emit a single-line `l1-empty` warn when
*     the final count is 0. See L1EmptyReason for the closed set.
*/
function parseExtractionResult(raw, logger) {
	try {
		const stripped = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
		let cleaned = stripped.trim();
		if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
		const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
		if (!arrayMatch) {
			logger?.warn?.(`${TAG} No JSON array found in extraction response`);
			const rawPreview = raw.slice(0, 2048);
			logger?.warn?.(`${TAG} [l1-debug] NO_JSON taskId=l1-extraction, rawLen=${raw.length}, strippedLen=${stripped.length}, cleanedLen=${cleaned.length}, rawFull=${JSON.stringify(rawPreview)}${raw.length > 2048 ? `…(+${raw.length - 2048})` : ""}`);
			return {
				scenes: [],
				emptyReason: "no_json"
			};
		}
		const sanitized = sanitizeJsonForParse(arrayMatch[0]);
		let parsed;
		try {
			parsed = JSON.parse(sanitized);
		} catch (err) {
			const repaired = repairExtractionJson(sanitized);
			if (repaired === sanitized) throw err;
			parsed = JSON.parse(repaired);
			logger?.warn?.(`${TAG} Repaired non-strict extraction JSON: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (!Array.isArray(parsed)) {
			logger?.warn?.(`${TAG} Extraction response is not an array`);
			return {
				scenes: [],
				emptyReason: "not_array"
			};
		}
		const scenes = [];
		for (const item of parsed) {
			if (!item || typeof item !== "object") continue;
			const s = item;
			scenes.push({
				scene_name: typeof s.scene_name === "string" ? s.scene_name : "未知情境",
				message_ids: Array.isArray(s.message_ids) ? s.message_ids.map(String) : [],
				memories: Array.isArray(s.memories) ? s.memories.filter((m) => m && typeof m === "object" && typeof m.content === "string" && m.content.length > 0).map((m) => ({
					content: String(m.content),
					type: String(m.type ?? "episodic"),
					priority: typeof m.priority === "number" ? m.priority : 50,
					source_message_ids: Array.isArray(m.source_message_ids) ? m.source_message_ids.map(String) : [],
					metadata: m.metadata && typeof m.metadata === "object" ? m.metadata : {}
				})) : []
			});
		}
		return {
			scenes,
			emptyReason: scenes.reduce((acc, sc) => acc + sc.memories.length, 0) === 0 ? "empty_scenes" : void 0
		};
	} catch (err) {
		logger?.warn?.(`${TAG} Failed to parse extraction result: ${err instanceof Error ? err.message : String(err)}`);
		logger?.warn?.(`${TAG} [l1-debug] PARSE_FAIL rawLen=${raw.length}, rawFull=${JSON.stringify(raw)}`);
		return {
			scenes: [],
			emptyReason: "parse_fail"
		};
	}
}
function repairExtractionJson(json) {
	return json.replace(/("priority"\s*:\s*)(?!-?\d+(?:\.\d+)?\s*[,}]|"[^"\\]*(?:\\.[^"\\]*)*"\s*[,}])([\s\S]*?)(?=,\s*"(?:content|type|priority|source_message_ids|metadata)"\s*:|[}\]])/g, (_m, prefix) => `${prefix}50`).replace(/,\s*([}\]])/g, "$1");
}
/**
* Apply batch dedup decisions — write memories according to their decisions.
*/
async function applyDecisions(params) {
	const { memoriesWithIds, decisions, baseDir, sessionKey, sessionId, taskId, teamId, userId, agentId, logger, vectorStore, embeddingService, storage } = params;
	const storedRecords = [];
	const decisionMap = /* @__PURE__ */ new Map();
	for (const d of decisions) decisionMap.set(d.record_id, d);
	for (const memoryWithId of memoriesWithIds) {
		const decision = decisionMap.get(memoryWithId.record_id) ?? {
			record_id: memoryWithId.record_id,
			action: "store",
			target_ids: []
		};
		try {
			const record = await writeMemory({
				memory: memoryWithId,
				decision,
				baseDir,
				sessionKey,
				sessionId,
				taskId,
				teamId,
				userId,
				agentId,
				logger,
				vectorStore,
				embeddingService,
				storage
			});
			if (record) storedRecords.push(record);
		} catch (err) {
			logger?.warn?.(`${TAG} Write failed for memory "${memoryWithId.content.slice(0, 50)}...": ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return storedRecords;
}
/**
* Store all memories directly (no dedup).
*/
async function storeAllDirectly(memoriesWithIds, baseDir, sessionKey, sessionId, taskId, teamId, userId, agentId, logger, vectorStore, embeddingService, storage) {
	const storedRecords = [];
	for (const memoryWithId of memoriesWithIds) try {
		const record = await writeMemory({
			memory: memoryWithId,
			decision: {
				record_id: memoryWithId.record_id,
				action: "store",
				target_ids: []
			},
			baseDir,
			sessionKey,
			sessionId,
			taskId,
			teamId,
			userId,
			agentId,
			logger,
			vectorStore,
			embeddingService,
			storage
		});
		if (record) storedRecords.push(record);
	} catch (err) {
		logger?.warn?.(`${TAG} Write failed for memory "${memoryWithId.content.slice(0, 50)}...": ${err instanceof Error ? err.message : String(err)}`);
	}
	return storedRecords;
}
const VALID_TYPES = [
	"persona",
	"episodic",
	"instruction",
	"work_fact",
	"work_task",
	"work_method",
	"work_artifact"
];
function normalizeType(raw) {
	const lower = raw.toLowerCase().trim();
	if (VALID_TYPES.includes(lower)) return lower;
	if (lower === "episode") return "episodic";
	if (lower === "instruct") return "instruction";
	if (lower === "preference") return "persona";
	return null;
}
export { extractL1Memories };
