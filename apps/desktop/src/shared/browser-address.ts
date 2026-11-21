export const LOCAL_FILE_APPROVAL_PARAM = "mingshenLocalFileApproval";

export function displayBrowserUrl(url: string | null | undefined): string {
  if (!url || url === "about:blank") {
    return "";
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete(LOCAL_FILE_APPROVAL_PARAM);
    return parsed.toString();
  } catch {
    return url;
  }
}
