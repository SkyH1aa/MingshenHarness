export type PolicyDocument = "terms" | "privacy" | "disclaimer" | "manual" | "changelog";
export interface PolicyConsent {
  terms: boolean;
  privacy: boolean;
  disclaimer: boolean;
}
export interface CompletionNotificationSettings {
  nativeEnabled: boolean;
  approvalEnabled?: boolean;
  questionEnabled?: boolean;
  taskbarEnabled: boolean;
  showPreview: boolean;
  sound: boolean;
}
export interface CompletionNotice {
  sessionId: string;
  runId: string;
  completedAt: string;
}
export interface CompletionNotificationState {
  unread: CompletionNotice[];
  settings: CompletionNotificationSettings;
  supported: boolean;
  badgeCount: number;
  lastError: string | null;
  lastDelivery: "idle" | "pending" | "shown" | "failed";
  replyDraft: { sessionId: string; text: string; error: string; id: string } | null;
}
export interface ReleaseMetadata {
  version: string;
  downloadUrl: string;
  notes: string;
  publishedAt: string;
  packageFormat: "zip" | "page";
  packageSha256: string | null;
  packageSize: number | null;
}
export interface UpdateStatus {
  state:
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "verifying"
    | "extracting"
    | "ready"
    | "installing"
    | "error";
  currentVersion: string;
  checkedAt: string | null;
  release: ReleaseMetadata | null;
  error: string | null;
  received?: number;
  total?: number | null;
  waitingForTasks?: number;
  installWhenIdle?: boolean;
}
export interface DependencyProgress {
  name: "docker" | "embiody" | "wsl";
  stage: "checking" | "downloading" | "installing" | "ready" | "error";
  received: number;
  total: number | null;
  detail: string;
}
