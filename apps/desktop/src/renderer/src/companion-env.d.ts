import type {
  CompanionAction,
  CompanionPreferences,
  CompanionState,
} from "../../shared/desktop-companion";

interface CompanionApi {
  getState(): Promise<CompanionState>;
  getPreferences(): Promise<CompanionPreferences>;
  setPreferences(patch: Partial<CompanionPreferences>): Promise<CompanionPreferences>;
  action(action: CompanionAction): Promise<CompanionState>;
  openMenu(): Promise<void>;
  openQuickChat(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  setMotionAvailability(allowed: boolean): Promise<void>;
  onState(listener: (state: CompanionState) => void): () => void;
  ready(): Promise<CompanionState>;
}

declare global {
  interface Window {
    companion?: CompanionApi;
  }
}
