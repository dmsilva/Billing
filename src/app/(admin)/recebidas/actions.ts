"use server";

import { updateInvoiceStatus, getInvoiceById } from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function validateInvoice(id: number) {
  const user = await getCurrentUser();
  const prev = getInvoiceById(id);
  updateInvoiceStatus(id, "Validada", user?.username || "admin");
  logAudit({
    userId: user?.id,
    username: user?.username || "admin",
    action: "validate",
    entityType: "invoice",
    entityId: id,
    fieldName: "validation_status",
    oldValue: prev?.validation_status || null,
    newValue: "Validada",
  });
  revalidatePath("/recebidas");
  revalidatePath("/faturas");
  revalidatePath("/");
}

export async function rejectInvoice(id: number) {
  const user = await getCurrentUser();
  const prev = getInvoiceById(id);
  updateInvoiceStatus(id, "Rejeitada", user?.username || "admin");
  logAudit({
    userId: user?.id,
    username: user?.username || "admin",
    action: "reject",
    entityType: "invoice",
    entityId: id,
    fieldName: "validation_status",
    oldValue: prev?.validation_status || null,
    newValue: "Rejeitada",
  });
  revalidatePath("/recebidas");
  revalidatePath("/faturas");
  revalidatePath("/");
}
