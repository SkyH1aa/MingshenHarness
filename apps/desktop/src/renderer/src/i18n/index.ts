import { useSyncExternalStore } from "react";
import english from "./en.json";

let locale: "zh-CN" | "en" = localStorage.getItem("mingshen.locale") === "en" ? "en" : "zh-CN";
const listeners = new Set<() => void>();
export function getLocale(): "zh-CN" | "en" {
  return locale;
}
export function setLocale(next: "zh-CN" | "en"): void {
  locale = next;
  localStorage.setItem("mingshen.locale", next);
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}
export function useLocale(): "zh-CN" | "en" {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => locale,
  );
}
const reverse = new Map(Object.entries(english).map(([key, value]) => [value, key]));
export function tr(text: string, values: unknown[] = []): string {
  const source = reverse.get(text) ?? text;
  const translated =
    locale === "en" ? ((english as Record<string, string>)[source] ?? text) : source;
  return translated.replace(/\{(\d+)\}/g, (_match, index: string) =>
    String(values[Number(index)] ?? ""),
  );
}
