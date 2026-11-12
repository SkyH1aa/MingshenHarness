export function formatDuration(seconds: number, locale: "zh-CN" | "en" = "zh-CN"): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remaining = total % 60;
  if (locale === "en") {
    return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${remaining}s`]
      .filter(Boolean)
      .join(" ");
  }
  return [hours ? `${hours} 小时` : "", hours || minutes ? `${minutes} 分` : "", `${remaining} 秒`]
    .filter(Boolean)
    .join(" ");
}
