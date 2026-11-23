# Plugin Hooks

Supported event names are `UserPromptSubmit`, `BeforeModelRequest`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop` and `Interrupt`.

## Per-request prompt injection

`BeforeModelRequest` is a declarative prompt hook for the primary CodeAgent and WorkAgent run. The host loads it before each model request in that run, including later tool-loop rounds and network retries, plus compaction and memory analysis/summary requests owned by the run. It can add a stable marker or bounded context to each request; it cannot alter requests already sent or guarantee that a model follows the text.

Only `type:"prompt"` text is accepted for this event. Command and MCP actions are ignored. The prompt accepts optional `position` (`"before"` or `"after"`, default `"before"`) and `format` (`"context"` or `"plain"`, default `"context"`). `format:"plain"` is the reusable attribution opt-out: with either position it omits `Plugin N`, the plugin heading, source attribution and the `<mingshen_plugin_context>` wrapper. Legacy `format:"context"` keeps that attribution; its default wraps text as low-priority plugin context before the original input and remains system context. `plain` sends only the declared text as ordinary user-visible request content. On an ordinary input round, `before + plain` precedes the input and `after` places text at the end. `after` plus `plain` therefore appends text such as `123abc` after the request content with one newline and no blank separator. If the request ends with an assistant message, the host adds a separate ordinary user tail message. If it ends with tool results, user-content placement follows the wire protocol: the host adds ordinary user text after the complete tool-result group, either as a text block in the existing user content or as a separate user tail message where that protocol requires one. It never inserts user-content plugin text between a tool call and its result and never rewrites, hides or splits their pairing. The addition is request-only and is not written into conversation history.

The aggregate collection budget is 3 seconds; one prompt is limited to 4,000 characters and the combined context to 12,000 characters. Invalid `position` or `format` values, missing text and budget overruns fail closed. If an active declaration cannot be read, times out or exceeds a limit, the affected model request is not sent. Cancellation propagates.

```json
{
  "hooks": {
    "BeforeModelRequest": [
      {
        "hooks": [
          {
            "type": "prompt",
            "text": "123abc",
            "position": "after",
            "format": "plain"
          }
        ]
      }
    ]
  }
}
```

For input `xxxx`, the request content ends as:

```text
xxxx
123abc
```

The wire join is a single newline: `xxxx\n123abc`. There is no blank separator. Plain text remains ordinary user-priority message content. It is not promoted to a system instruction and cannot override higher-priority instructions.

An enabled `on-demand` plugin can be activated with `use_plugin` during a run. Its `BeforeModelRequest` context starts on the next model request; it cannot be injected into the request that discovered the plugin. To include it from the first request, the user must select an `activation:"required"` plugin before submitting.

Actual child tasks derived through an active parent run's `runSubagent` path inherit only the parent's selected/activated plugins' declarative `type:"prompt"` context. This applies to the child's initial request and subsequent requests; later parent-run activation is consulted before each next unsent child request. It does not expose plugin activation, `UserPromptSubmit`, `Interrupt`, plugin commands, MCP, action hooks or `local_plugin` to the child. Independent child conversations opened directly with `@` and no active parent-run mapping do not inherit this context.

`BeforeModelRequest` does not run for ChatAgent, approval-safety reviews, independent AutoDrive/draft-polishing jobs or post-run title generation. Wrapped `context` is low-priority untrusted data; `plain` is ordinary user-visible text. Neither can override system policy, permissions, approvals or tool boundaries.

## Other events

`UserPromptSubmit` sees only plugins selected when the user submits. It is not replayed when the Agent later activates a plugin. Action hooks require host execution, Full Access and a trusted project. They do not execute in Request Approval, Docker, ChatAgent, actual SubAgents or read-only profiles. Shell actions also require the explicit shell-hook setting and per-action approval. MCP actions require an enabled/configured server and normal approval.

`Interrupt` is a bounded cleanup notification. Its prompt activity may be recorded, but command/MCP actions are skipped. Never describe an action hook as executed unless the host reports an execution result.
