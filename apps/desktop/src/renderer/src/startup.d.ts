import type { StartupPresentationApi } from "../../shared/startup-presentation";

declare global {
  interface Window {
    startupPresentation: StartupPresentationApi;
  }
}
