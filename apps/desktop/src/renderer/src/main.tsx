import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DesktopShell } from "./components/DesktopShell";
import { DialogProvider } from "./components/DialogProvider";
import { ModelCatalogProvider } from "./components/ModelCatalogPreferences";
import { UiPreferencesProvider } from "./components/UiPreferences";
import { registerComposerDraftLifecycle } from "./lib/use-composer-draft";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./workbench.css";
import "./orbit.css";
import "./orbit-workbench.css";
import "./model-catalog.css";

const root = document.getElementById("root");
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
