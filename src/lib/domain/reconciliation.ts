import type { CashClose, CashCheck } from "@/lib/db";

export type CheckType = "cv" | "mb" | "money";
export const CHECK_TYPES: CheckType[] = ["cv", "mb", "money"];

export interface ReconcileItem {
  cashClose: CashClose;
  type: CheckType;
  expected: number;
  check: CashCheck | null;
}

export function getExpectedValue(close: CashClose, type: CheckType): number {
  switch (type) {
    case "cv": return close.cv;
    case "mb": return close.mb;
    case "money": return close.money;
  }
}

export function checkLabel(type: CheckType): string {
  switch (type) {
    case "cv": return "CV";
    case "mb": return "MB";
    case "money": return "Numerário";
  }
}

export function checkIcon(type: CheckType): string {
  switch (type) {
    case "cv": return "💳";
    case "mb": return "💳";
    case "money": return "💶";
  }
}

export function shiftLabel(shift: string): string {
  switch (shift) {
    case "7h": return "Noite";
    case "15h": return "Manhã";
    case "23h": return "Tarde";
    default: return shift;
  }
}

export function shiftHours(shift: string): string {
  switch (shift) {
    case "7h": return "23:00–07:00";
    case "15h": return "07:00–15:00";
    case "23h": return "15:00–23:00";
    default: return "";
  }
}

export function buildReconcileQueue(
  closes: CashClose[],
  checks: CashCheck[]
): ReconcileItem[] {
  const checkMap = new Map<string, CashCheck>();
  for (const c of checks) {
    checkMap.set(`${c.cash_close_id}|${c.type}`, c);
  }

  const items: ReconcileItem[] = [];
  for (const close of closes) {
    for (const type of CHECK_TYPES) {
      const key = `${close.id}|${type}`;
      items.push({
        cashClose: close,
        type,
        expected: getExpectedValue(close, type),
        check: checkMap.get(key) || null,
      });
    }
  }
  return items;
}

export function findNextPendingIndex(items: ReconcileItem[]): number {
  const idx = items.findIndex(item => !item.check);
  return idx === -1 ? items.length - 1 : idx;
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function euro(n: number | null | undefined): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(n || 0));
}

export function euroShort(n: number | null | undefined): string {
  const val = Number(n || 0);
  return val.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
