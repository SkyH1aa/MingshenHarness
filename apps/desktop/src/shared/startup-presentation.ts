export const STARTUP_PRESENTATION_SETTING_KEY = "desktop.startup-animation";

export const STARTUP_PRESENTATION_CHANNELS = {
  stage: "startup-presentation:stage",
  skip: "startup-presentation:skip",
} as const;

export type StartupPresentationStage = "preparing" | "settings" | "services" | "window" | "ready";
export type StartupPresentationLocale = "zh-CN" | "en";

export interface StartupPresentationApi {
  onStage(
    listener: (stage: StartupPresentationStage, locale: StartupPresentationLocale) => void,
  ): () => void;
  skip(): void;
}

export function startupPresentationEnabled(value: unknown): boolean {
  return value !== false;
}
