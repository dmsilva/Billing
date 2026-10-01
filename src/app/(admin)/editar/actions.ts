"use server";

import {
  updateTransactionCategory, updateTransactionProperty,
  getBankTransactionById, createCategory, updateCategoryName, toggleCategoryActive,
  getCategoryLookup, getPropertyLookup,
} from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function changeTransactionCategory(txId: number, categoryId: number | null) {
  const user = await getCurrentUser();
  const tx = getBankTransactionById(txId);
  const catLookup = getCategoryLookup();
  const oldCat = tx ? catLookup.get(tx.category_id ?? -1) || "—" : "—";
  const newCat = categoryId ? catLookup.get(categoryId) || "—" : "—";

  updateTransactionCategory(txId, categoryId);
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "change_category",
    entityType: "bank_transaction",
    entityId: txId,
    fieldName: "category_id",
    oldValue: oldCat,
    newValue: newCat,
  });
  revalidatePath("/editar");
  revalidatePath("/cgd");
  revalidatePath("/categorias");
  revalidatePath("/");
}

export async function changeTransactionProperty(txId: number, propertyId: number | null) {
  const user = await getCurrentUser();
  const tx = getBankTransactionById(txId);
  const propLookup = getPropertyLookup();
  const oldProp = tx ? propLookup.get(tx.property_id ?? -1) || "—" : "—";
  const newProp = propertyId ? propLookup.get(propertyId) || "—" : "—";

  updateTransactionProperty(txId, propertyId);
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "change_property",
    entityType: "bank_transaction",
    entityId: txId,
    fieldName: "property_id",
    oldValue: oldProp,
    newValue: newProp,
  });
  revalidatePath("/editar");
  revalidatePath("/cgd");
  revalidatePath("/");
}

export async function addCategory(name: string) {
  const user = await getCurrentUser();
  const id = createCategory(name.trim());
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "create",
    entityType: "category",
    entityId: id,
    newValue: name.trim(),
  });
  revalidatePath("/editar");
  revalidatePath("/categorias");
}

export async function renameCategory(id: number, newName: string) {
  const user = await getCurrentUser();
  const catLookup = getCategoryLookup();
  const oldName = catLookup.get(id) || "—";
  updateCategoryName(id, newName.trim());
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: "rename",
    entityType: "category",
    entityId: id,
    fieldName: "name",
    oldValue: oldName,
    newValue: newName.trim(),
  });
  revalidatePath("/editar");
  revalidatePath("/categorias");
}

export async function setCategoryActive(id: number, active: boolean) {
  const user = await getCurrentUser();
  toggleCategoryActive(id, active);
  logAudit({
    userId: user?.id,
    username: user?.username,
    action: active ? "activate" : "deactivate",
    entityType: "category",
    entityId: id,
  });
  revalidatePath("/editar");
  revalidatePath("/categorias");
}
