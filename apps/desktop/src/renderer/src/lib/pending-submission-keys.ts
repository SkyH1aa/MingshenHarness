export interface PendingSubmissionIdentity {
  sessionId: string;
  draftRevision: string;
  temporaryInstruction?: string | undefined;
}

interface PendingSubmission {
  signature: string;
  key: string;
}

export function submissionSignature(input: PendingSubmissionIdentity): string {
  return JSON.stringify([
    input.sessionId,
    input.draftRevision,
    input.temporaryInstruction?.trim() ?? "",
  ]);
}

/**
 * Keeps one uncertain renderer submission per session until the host confirms
 * acceptance. Editing the draft changes its revision and therefore the key.
 */
export class PendingSubmissionKeys {
  private readonly submissions = new Map<string, PendingSubmission>();
  private readonly createKey: () => string;

  constructor(createKey: () => string = () => crypto.randomUUID()) {
    this.createKey = createKey;
  }

  acquire(input: PendingSubmissionIdentity): string {
    const signature = submissionSignature(input);
    const existing = this.submissions.get(input.sessionId);
    if (existing?.signature === signature) return existing.key;
    const key = this.createKey();
    this.submissions.set(input.sessionId, { signature, key });
    return key;
  }

  release(input: PendingSubmissionIdentity): void {
    const signature = submissionSignature(input);
    const existing = this.submissions.get(input.sessionId);
    if (existing?.signature === signature) this.submissions.delete(input.sessionId);
  }

  forgetSession(sessionId: string): void {
    this.submissions.delete(sessionId);
  }
}
