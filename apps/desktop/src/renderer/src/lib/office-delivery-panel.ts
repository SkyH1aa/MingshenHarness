import type {
  OfficeDeliveryReceipt,
  OfficeDeliveryStageStatus,
  OfficeDeliveryStatus,
} from "../../../shared/office-delivery";

const CONTINUABLE_STAGE_STATUSES = new Set<OfficeDeliveryStageStatus>(["verified", "partial"]);

export function firstUninspectedOfficePage(receipt: OfficeDeliveryReceipt): number | null {
  const totalPages = receipt.visual.totalPages;
  if (!totalPages || totalPages < 1) return null;
  const inspected = new Set(
    receipt.visual.pageNumbers.filter(
      (page) => Number.isInteger(page) && page >= 1 && page <= totalPages,
    ),
  );
  for (let page = 1; page <= totalPages; page += 1) {
    if (!inspected.has(page)) return page;
  }
  return null;
}

export function canContinueOfficeDelivery(receipt: OfficeDeliveryReceipt): boolean {
  return (
    receipt.status !== "stale" &&
    receipt.status !== "blocked" &&
    CONTINUABLE_STAGE_STATUSES.has(receipt.stages.structure) &&
    CONTINUABLE_STAGE_STATUSES.has(receipt.stages.render) &&
    receipt.stages.visual === "partial" &&
    firstUninspectedOfficePage(receipt) !== null
  );
}

export function officeDeliveryStatusLabel(
  status: OfficeDeliveryStatus,
  locale: "zh" | "en",
): string {
  const labels: Record<OfficeDeliveryStatus, { zh: string; en: string }> = {
    verified: { zh: "已验证", en: "Verified" },
    partial: { zh: "部分验证", en: "Partially verified" },
    unverified: { zh: "未验证", en: "Unverified" },
    blocked: { zh: "已阻止", en: "Blocked" },
    stale: { zh: "文件已变化", en: "File changed" },
  };
  return labels[status][locale];
}
