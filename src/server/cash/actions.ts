"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import type { ActionResult } from "@/server/orders/domain";
import * as domain from "./domain";
import type { CashCategoryDTO, CashEntryDTO } from "./domain";

// Toda action exige sessão válida. Erros em pt-BR com `fieldErrors` por campo
// (direction, amountCents, categoryId, method, occurredAt, description / name, direction).

function refreshCash() {
  revalidatePath("/caixa");
  revalidatePath("/caixa/categorias");
}

/**
 * Novo lançamento manual. `input`: { direction: "IN"|"OUT", amountCents, categoryId, method,
 * occurredAt? (ISO com offset, não futura), description? }.
 */
export async function createCashEntryAction(input: unknown): Promise<ActionResult<CashEntryDTO>> {
  await requireSession();
  const r = await domain.createCashEntry(db, input);
  if (r.ok) refreshCash();
  return r;
}

/** Edição completa (mesmos campos da criação). Pagamento de atendimento é recusado. */
export async function updateCashEntryAction(
  id: number,
  input: unknown,
): Promise<ActionResult<CashEntryDTO>> {
  await requireSession();
  const r = await domain.updateCashEntry(db, id, input);
  if (r.ok) refreshCash();
  return r;
}

export async function deleteCashEntryAction(id: number): Promise<ActionResult<{ id: number }>> {
  await requireSession();
  const r = await domain.deleteCashEntry(db, id);
  if (r.ok) refreshCash();
  return r;
}

/** `input`: { name, direction }. */
export async function createCashCategoryAction(
  input: unknown,
): Promise<ActionResult<CashCategoryDTO>> {
  await requireSession();
  const r = await domain.createCashCategory(db, input);
  if (r.ok) refreshCash();
  return r;
}

/** `input`: { name?, direction? } (direction só em categoria nunca usada e que não é de sistema). */
export async function updateCashCategoryAction(
  id: number,
  input: unknown,
): Promise<ActionResult<CashCategoryDTO>> {
  await requireSession();
  const r = await domain.updateCashCategory(db, id, input);
  if (r.ok) refreshCash();
  return r;
}

export async function setCashCategoryActiveAction(
  id: number,
  active: boolean,
): Promise<ActionResult<CashCategoryDTO>> {
  await requireSession();
  const r = await domain.setCashCategoryActive(db, id, active);
  if (r.ok) refreshCash();
  return r;
}

export async function deleteCashCategoryAction(id: number): Promise<ActionResult<{ id: number }>> {
  await requireSession();
  const r = await domain.deleteCashCategory(db, id);
  if (r.ok) refreshCash();
  return r;
}
