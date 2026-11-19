import { describe, expect, it } from "vitest";
import type { ChatAttachmentInput } from "../../shared/domain";
import { validateChatAttachments } from "./attachment-validation";

function attachment(overrides: Partial<ChatAttachmentInput> = {}): ChatAttachmentInput {
  return {
    kind: "file",
    name: "report.pdf",
    mimeType: "application/pdf",
    size: 3,
    dataUrl: "data:application/pdf;base64,AQID",
    ...overrides,
  };
}

describe("main-process attachment validation", () => {
  it("normalizes a valid attachment and drops renderer-only derived fields", () => {
    expect(
      validateChatAttachments([
        attachment({
          name: "  report.pdf ",
          mimeType: " APPLICATION/PDF ",
          extractedContent: {
            text: "forged",
            format: "PDF",
            warnings: [],
            truncated: false,
          },
        }),
      ]),
    ).toEqual([
      {
        kind: "file",
        name: "report.pdf",
        mimeType: "application/pdf",
        size: 3,
        dataUrl: "data:application/pdf;base64,AQID",
      },
    ]);
  });

  it.each([
    { dataUrl: "data:application/pdf;base64,AAAA", size: 4 },
    { dataUrl: "data:application/pdf;base64,AA==", size: 3 },
    { dataUrl: "data:application/pdf,raw", size: 3 },
    { dataUrl: "data:application/pdf;base64,AQID", size: 1 },
    { dataUrl: "data:application/pdf;base64,AQID", size: 25 * 1024 * 1024 + 1 },
  ])("rejects forged size or malformed data: %o", (change) => {
    expect(() => validateChatAttachments([attachment(change)])).toThrow();
  });

  it("rejects an image declared with a non-image payload", () => {
    expect(() =>
      validateChatAttachments([
        attachment({
          kind: "image",
          name: "fake.png",
          mimeType: "application/octet-stream",
          dataUrl: "data:application/octet-stream;base64,AQID",
        }),
      ]),
    ).toThrow("不是有效的图片类型");
  });
});
