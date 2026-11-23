import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DesktopShell } from "./components/DesktopShell";
import { DialogProvider } from "./components/DialogProvider";
import { ModelCatalogProvider } from "./components/ModelCatalogPreferences";
import { UiPreferencesProvider } from "./components/UiPreferences";
import { registerComposerDraftLifecycle } from "./lib/use-composer-draft";
import { QuickChatApp } from "./QuickChatApp";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./workbench.css";
import "./orbit.css";
import "./orbit-workbench.css";
import "./model-catalog.css";
import "./agent-modes.css";
import "./quick-chat.css";
import "./image-studio.css";
import "./studio-navigation.css";
import "./desktop-experience-settings.css";
import "./simple-workbench.css";

const root = document.getElementById("root");
const quickChatSurface =
  new URLSearchParams(window.location.search).get("surface") === "quick-chat";
registerComposerDraftLifecycle();

function report(source: "window" | "promise", cause: unknown): void {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "Unhandled renderer error";
  void window.mingshen
    .reportRuntimeError({
      source,
      message: message.slice(0, 16000),
      ...(cause instanceof Error && cause.stack ? { stack: cause.stack.slice(0, 16000) } : {}),
    })
    .catch(() => undefined);
}
window.addEventListener("error", (event) => report("window", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => report("promise", event.reason));

if (!root) {
  throw new Error("Missing renderer root");
}

if (quickChatSurface) {
  document.body.dataset.surface = "quick-chat";
  createRoot(root).render(
    <StrictMode>
      <DialogProvider>
        <UiPreferencesProvider>
          <ModelCatalogProvider>
            <QuickChatApp />
          </ModelCatalogProvider>
        </UiPreferencesProvider>
      </DialogProvider>
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <DialogProvider>
        <DesktopShell>
          <UiPreferencesProvider>
            <ModelCatalogProvider>
              <App />
            </ModelCatalogProvider>
          </UiPreferencesProvider>
        </DesktopShell>
      </DialogProvider>
    </StrictMode>,
  );
}
