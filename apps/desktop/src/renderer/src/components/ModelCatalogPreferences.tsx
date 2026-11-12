import { RefreshCw } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocale } from "../i18n";
import { runtimeText } from "../i18n/runtime";
import { ModelCatalogStore } from "../lib/model-catalog-store";

const Context = createContext<ModelCatalogStore | null>(null);

export function ModelCatalogProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ModelCatalogStore(() => window.mingshen));
  useEffect(() => {
    void store.load().catch(() => undefined);
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useModelCatalog() {
  const store = useContext(Context);
  if (!store) throw new Error("Model catalog provider is missing.");
  return {
    ...useSyncExternalStore(store.subscribe, store.getSnapshot),
    moveProvider: store.moveProvider,
    setStar: store.setStar,
    refresh: store.refresh,
    retry: store.retry,
  };
}

export function ModelCatalogFeedback() {
  const { error, saving, retry } = useModelCatalog();
  const en = useLocale() === "en";
  if (!error) return null;
  return (
    <div className="model-catalog-feedback" role="alert">
      <span>
        {en
          ? "Could not save or load model preferences."
          : "\u6A21\u578B\u504F\u597D\u4FDD\u5B58\u6216\u8BFB\u53D6\u5931\u8D25\u3002"}
        <small>{runtimeText(error)}</small>
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={saving}
        onClick={() => void retry().catch(() => undefined)}
      >
        <RefreshCw size={14} aria-hidden="true" />
        {en ? "Retry" : "\u91CD\u8BD5"}
      </button>
    </div>
  );
}
