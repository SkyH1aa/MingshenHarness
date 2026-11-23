import type {
  CompanionSessionNavigationFailure,
  CompanionSessionNavigationResult,
} from "../../../shared/ipc";

export class SessionSelectionSequence {
  private current = 0;

  begin(): () => boolean {
    const sequence = ++this.current;
    return () => sequence === this.current;
  }

  capture(): () => boolean {
    const sequence = this.current;
    return () => sequence === this.current;
  }
}

export async function respondToCompanionNavigation<T extends { archived: boolean }>(input: {
  requestId: string;
  sessionId: string;
  sequence: SessionSelectionSequence;
  knownSession: (sessionId: string) => T | undefined;
  loadSession: (sessionId: string) => Promise<T | null>;
  navigationFailure: (
    sessionId: string,
    session: T | undefined,
  ) => CompanionSessionNavigationFailure | null;
  preflight: (requestId: string, sessionId: string) => boolean;
  claim: (requestId: string, sessionId: string) => boolean;
  commit: (session: T, loaded: boolean) => void;
  report: (result: CompanionSessionNavigationResult) => Promise<void>;
}): Promise<void> {
  const reject = (reason: CompanionSessionNavigationFailure) =>
    input.report({ requestId: input.requestId, accepted: false, reason });
  let session = input.knownSession(input.sessionId);
  const initialFailure = input.navigationFailure(input.sessionId, session);
  if (initialFailure) return reject(initialFailure);
  if (!input.preflight(input.requestId, input.sessionId)) return;
  const isCurrent = input.sequence.begin();

  let loaded = false;
  try {
    if (!session) {
      session = (await input.loadSession(input.sessionId)) ?? undefined;
      loaded = true;
    }
  } catch {
    return reject("failed");
  }
  if (!isCurrent()) return reject("failed");
  if (!session || session.archived) return reject("unavailable");
  const failure = input.navigationFailure(input.sessionId, session);
  if (failure) return reject(failure);
  if (input.claim(input.requestId, input.sessionId)) input.commit(session, loaded);
}
