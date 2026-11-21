export const MAX_PENDING_RUN_STEERING = 10;
export const MAX_RUN_STEERING_TEXT_CHARS = 8_000;
export const MAX_RUN_STEERING_TOTAL_CHARS = 32_000;

export interface RunSteeringInput {
  sessionId: string;
  runId: string;
  requestId: string;
  text: string;
  draftRevision?: string;
}

export interface RunSteeringMessage {
  id: string;
  text: string;
  status: "pending" | "delivered" | "unapplied";
  createdAt: string;
  deliveredAt: string | null;
  reason: string | null;
}

export interface RunSteeringState {
  sessionId: string;
  runId: string;
  accepting: boolean;
  messages: RunSteeringMessage[];
}

export interface RunSteeringReceipt {
  runId: string;
  messageId: string;
}
