export function isPasteInputType(inputType: string | null | undefined): boolean {
  return inputType === "insertFromPaste" || inputType === "insertFromPasteAsQuotation";
}

/**
 * The editor is allowed to switch into the formatted preview only when the browser identifies
 * this exact change as a paste. Ordinary text and IME composition must never satisfy this check,
 * even if a previous paste event left its marker behind.
 */
export function shouldOpenPastePreview(options: {
  inputType: string | null | undefined;
  pastePending: boolean;
  richPasteEnabled: boolean;
}): boolean {
  // Some paste paths (including synthetic and older Chromium paths) report the insertion
  // as insertText. Requiring the pending flag still keeps ordinary typing out of preview.
  return (
    options.richPasteEnabled &&
    options.pastePending &&
    (isPasteInputType(options.inputType) || options.inputType === "insertText")
  );
}
