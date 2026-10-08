"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import type { ActionResult } from "@/server/orders/domain";
import * as domain from "./domain";
import type { DeleteMovementResult, StockMovementResult } from "./domain";

// Toda action exige sessão válida; sem ela redireciona para /login. Erros em pt-BR com `fieldErrors`
// (productId, quantity, reason, occurredAt, countedQuantity, purchase.amountCents, purchase.method).

function refresh<T>(r: ActionResult<T>, productId?: number): ActionResult<T> {
  if (r.ok) {
    revalidatePath("/estoque");
    revalidatePath("/produtos");
    revalidatePath("/caixa");
    revalidatePath("/");
    if (productId) revalidatePath(`/estoque/${productId}`);
  }
  return r;
}

function productIdOf(input: unknown): number | undefined {
  const v = (input as { productId?: unknown } | null)?.productId;
  return typeof v === "number" ? v : undefined;
}

/**
 * Entrada. `input`: { productId, quantity (inteiro > 0), reason?, occurredAt? (ISO com offset, não futura),
 * purchase?: { amountCents (> 0, total da compra), method: CASH|PIX|DEBIT_CARD|CREDIT_CARD } }.
 * Com `purchase`, cria a saída "Compra de produtos" no caixa; sem ela o caixa não muda.
 */
export async function registerStockInAction(
  input: unknown,
): Promise<ActionResult<StockMovementResult>> {
  await requireSession();
  return refresh(await domain.registerStockIn(db, input), productIdOf(input));
}

/** Baixa manual. `input`: { productId, quantity (> 0, <= disponível), reason (obrigatório), occurredAt? }. */
export async function registerStockOutAction(
  input: unknown,
): Promise<ActionResult<StockMovementResult>> {
  await requireSession();
  return refresh(await domain.registerStockOut(db, input), productIdOf(input));
}

/** Acerto: `input`: { productId, countedQuantity (>= 0), reason?, occurredAt? }. Contagem igual ao saldo é recusada. */
export async function adjustStockAction(
  input: unknown,
): Promise<ActionResult<StockMovementResult>> {
  await requireSession();
  return refresh(await domain.adjustStock(db, input), productIdOf(input));
}

/**
 * Edita movimentação manual. `input`: { quantity (IN/OUT > 0; ADJUSTMENT delta com sinal != 0), reason?,
 * occurredAt?, purchase? (só IN: undefined mantém, null remove a despesa, objeto cria/atualiza) }.
 */
export async function updateStockMovementAction(
  id: number,
  input: unknown,
): Promise<ActionResult<StockMovementResult>> {
  await requireSession();
  const r = await domain.updateStockMovement(db, id, input);
  return refresh(r, r.ok ? r.data.movement.productId : undefined);
}

/** Exclui movimentação manual (a despesa de compra vinculada é excluída junto). SALE é recusada. */
export async function deleteStockMovementAction(
  id: number,
): Promise<ActionResult<DeleteMovementResult>> {
  await requireSession();
  const r = await domain.deleteStockMovement(db, id);
  return refresh(r, r.ok ? r.data.productId : undefined);
}
