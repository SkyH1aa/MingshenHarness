import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_PROJECT_LAYOUT,
  type InterfaceStyle,
  normalizeUiPreferences,
  type ProjectLayout,
  projectLayoutKey,
  type UiPreferences,
} from "../../../shared/ui-preferences";

interface PreferencesContext {
  preferences: UiPreferences;
  activeStyle: InterfaceStyle;
  ready: boolean;
  error: string;
  update(change: (current: UiPreferences) => UiPreferences): void;
  save(): Promise<void>;
  retry(): void;
}
const Context = createContext<PreferencesContext | null>(null);
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => normalizeUiPreferences(null));
  const current = useRef(preferences);
  const [activeStyle, setActiveStyle] = useState<InterfaceStyle>("simple");
  const styleLoaded = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const pending = useRef<UiPreferences | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const flush = useCallback((): Promise<void> => {
    if (saving.current) return saving.current;
    const task = (async () => {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        try {
          await window.mingshen.saveUiPreferences(next);
          if (mounted.current) setError("");
        } catch (cause) {
          pending.current ??= next;
          if (mounted.current) setError(String(cause));
          throw cause;
        }
      }
    })();
    saving.current = task;
    void task
      .finally(() => {
        if (saving.current === task) saving.current = null;
      })
      .catch(() => undefined);
    return task;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry reloads failed persisted preferences.
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void window.mingshen
      .getUiPreferences()
      .then((next) => {
        if (!active) return;
        const loaded = normalizeUiPreferences(next);
        current.current = loaded;
        setPreferences(loaded);
        if (!styleLoaded.current) {
          styleLoaded.current = true;
          setActiveStyle(loaded.interfaceStyle);
        }
        setError("");
        setReady(true);
      })
      .catch((cause) => {
        if (active) {
          setError(String(cause));
          setReady(false);
        }
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [loadAttempt]);
  useEffect(() => {
    document.documentElement.dataset.motion = preferences.motion;
  }, [preferences.motion]);
  useEffect(() => {
    document.documentElement.dataset.interfaceStyle = activeStyle;
  }, [activeStyle]);
  useEffect(() => {
    const syncVisibility = () => {
      document.documentElement.dataset.pageVisible = String(!document.hidden);
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  const update = useCallback(
    (change: (current: UiPreferences) => UiPreferences) => {
      if (!ready) return;
      const next = normalizeUiPreferences(change(current.current));
      current.current = next;
      pending.current = next;
      setPreferences(next);
    },
    [ready],
  );
  useEffect(() => {
    if (ready && pending.current === preferences) void flush().catch(() => undefined);
  }, [preferences, ready, flush]);
  const save = useCallback(async () => {
    if (!ready) throw new Error(error || "UI preferences are not ready.");
    await flush();
    if (pending.current) await flush();
  }, [ready, error, flush]);
  return (
    <Context.Provider
      value={{
        preferences,
        activeStyle,
        ready,
        error,
        update,
        save,
        retry: () =>
          ready ? void flush().catch(() => undefined) : setLoadAttempt((value) => value + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useUiPreferences() {
  const context = useContext(Context);
  if (!context) throw new Error("UI preferences provider is missing.");
  return context;
}
export function useProjectLayout(workspace: string | null) {
  const context = useUiPreferences();
  const optical = context.activeStyle === "orbit";
  const key = projectLayoutKey(workspace, context.activeStyle);
  const layout = context.preferences.projects[key] ?? {
    ...DEFAULT_PROJECT_LAYOUT,
    ...(optical ? { sidebarWidth: 228, inspectorWidth: 360 } : {}),
    mode: context.preferences.defaultLayout,
    inspectorOpen: optical || context.preferences.defaultLayout !== "chat",
  };
  const setLayout = (change: Partial<ProjectLayout>) =>
    context.update((current) => ({
      ...current,
      projects: { ...current.projects, [key]: { ...(current.projects[key] ?? layout), ...change } },
    }));
  return { ...context, layout, setLayout };
}
