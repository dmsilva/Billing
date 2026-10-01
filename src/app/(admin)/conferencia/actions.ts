"use server";

import { getAllCashCloses, getAllCashChecks, upsertCashCheck, clearAllCashChecks, getReconciliationStats, getCashCloseById } from "@/lib/db/queries";
import { buildReconcileQueue, findNextPendingIndex, type ReconcileItem, CHECK_TYPES, getExpectedValue } from "@/lib/domain/reconciliation";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export interface ConferenceState {
  items: ReconcileItem[];
  currentIndex: number;
  stats: {
    totalCloses: number;
    totalChecks: number;
    doneChecks: number;
    okChecks: number;
    diffChecks: number;
  };
}

export async function getConferenceState(): Promise<ConferenceState> {
  const closes = getAllCashCloses();
  const checks = getAllCashChecks();
  const items = buildReconcileQueue(closes, checks);
  const currentIndex = findNextPendingIndex(items);
  const stats = getReconciliationStats();

  return { items, currentIndex, stats };
}

export async function confirmCheck(
  cashCloseId: number,
  type: string,
  actualValue: number | null
): Promise<{ success: boolean }> {
  const close = getCashCloseById(cashCloseId);
  if (!close) return { success: false };

  const checkType = type as "cv" | "mb" | "money";
  const expected = getExpectedValue(close, checkType);
  const actual = actualValue ?? expected;

  upsertCashCheck(cashCloseId, type, expected, actual);
  const user = await getCurrentUser();
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "reconcile",
    entityType: "cash_check",
    entityId: cashCloseId,
    fieldName: type,
    oldValue: null,
    newValue: String(actual),
  });
  revalidatePath("/conferencia");
  return { success: true };
}

export async function editCheck(
  cashCloseId: number,
  type: string,
  newActualValue: number
): Promise<{ success: boolean }> {
  const close = getCashCloseById(cashCloseId);
  if (!close) return { success: false };

  const checkType = type as "cv" | "mb" | "money";
  const expected = getExpectedValue(close, checkType);

  upsertCashCheck(cashCloseId, type, expected, newActualValue);
  const user = await getCurrentUser();
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "edit_reconcile",
    entityType: "cash_check",
    entityId: cashCloseId,
    fieldName: type,
    oldValue: null,
    newValue: String(newActualValue),
  });
  revalidatePath("/conferencia");
  return { success: true };
}

export async function resetAllChecks(): Promise<void> {
  const user = await getCurrentUser();
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "reset_all",
    entityType: "cash_check",
  });
  clearAllCashChecks();
  revalidatePath("/conferencia");
}
