import type {
  ApprovalRequest,
  ApprovalState,
  QuestionRequest,
  QuestionState,
} from "../../../shared/domain";

export function newerPendingState<T extends { revision: number }>(current: T, incoming: T): T {
  return incoming.revision > current.revision ? incoming : current;
}

export function approvalsFromSnapshot(state: ApprovalState): Record<string, ApprovalRequest> {
  const requests: Record<string, ApprovalRequest> = {};
  for (const request of state.requests) requests[request.sessionId] ??= request;
  return requests;
}

export function questionsFromSnapshot(state: QuestionState): Record<string, QuestionRequest> {
  const requests: Record<string, QuestionRequest> = {};
  for (const request of state.requests) requests[request.sessionId] ??= request;
  return requests;
}
