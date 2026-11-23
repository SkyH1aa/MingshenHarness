import { contextBridge, ipcRenderer } from "electron";
import type {
  StartupPresentationApi,
  StartupPresentationLocale,
  StartupPresentationStage,
} from "../shared/startup-presentation";
import { STARTUP_PRESENTATION_CHANNELS } from "../shared/startup-presentation";

let stage: StartupPresentationStage = "preparing";
let locale: StartupPresentationLocale = "zh-CN";
const listeners = new Set<Parameters<StartupPresentationApi["onStage"]>[0]>();
ipcRenderer.on(STARTUP_PRESENTATION_CHANNELS.stage, (_event, value: unknown, language: unknown) => {
  if (
    value !== "preparing" &&
    value !== "settings" &&
    value !== "services" &&
    value !== "window" &&
    value !== "ready"
  )
    return;
  stage = value;
  locale = language === "en" ? "en" : "zh-CN";
  for (const listener of listeners) listener(stage, locale);
});

const api: StartupPresentationApi = {
  onStage(listener) {
    listeners.add(listener);
    listener(stage, locale);
    return () => listeners.delete(listener);
  },
  skip() {
    ipcRenderer.send(STARTUP_PRESENTATION_CHANNELS.skip);
  },
};

contextBridge.exposeInMainWorld("startupPresentation", api);
