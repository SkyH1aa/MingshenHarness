import type { MessagePart, SessionMessage } from "../../../shared/domain";

interface OrbitTranscriptEntry {
  messages: SessionMessage[];
  execution: boolean;
  showAssistantHeader: boolean;
}

function invisiblePart(part: MessagePart): boolean {
  return (
    part.type === "responses_state" ||
    part.type === "provider_state" ||
    ((part.type === "text" || part.type === "reasoning") && !part.text.trim())
  );
}

export function orbitTranscript(messages: readonly SessionMessage[]): OrbitTranscriptEntry[] {
  const entries: OrbitTranscriptEntry[] = [];
  let execution: OrbitTranscriptEntry | null = null;
  let assistantHeaderPending = true;

  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "assistant" && message.parts.every(invisiblePart)) continue;

    const executionOnly =
      message.role === "assistant" &&
      message.parts.every(
        (part) => invisiblePart(part) || part.type === "tool_call" || part.type === "reasoning",
      );
    const showAssistantHeader = message.role === "assistant" && assistantHeaderPending;
    assistantHeaderPending = message.role === "user";

    if (executionOnly) {
      if (!execution) {
        execution = { messages: [], execution: true, showAssistantHeader };
        entries.push(execution);
      }
      execution.messages.push(message);
    } else {
      execution = null;
      entries.push({ messages: [message], execution: false, showAssistantHeader });
    }
  }
  return entries;
}
