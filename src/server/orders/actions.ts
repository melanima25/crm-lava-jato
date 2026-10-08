"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";
import { receiveFromCustomer, type ReceiveResult } from "./debt";
import type { ActionResult, OrderDetail } from "./domain";

// Toda action exige sessão válida; sem ela redireciona para /login.
// Cadastro rápido: o frontend chama createCustomerAction -> createVehicleAction -> createOrderAction (D-36).

function refresh(r: ActionResult<OrderDetail>): ActionResult<OrderDetail> {
  if (r.ok) {
    revalidatePath("/atendimentos");
    revalidatePath(`/atendimentos/${r.data.id}`);
    revalidatePath("/caixa");
    revalidatePath(`/clientes/${r.data.customer.id}`);
    // Vendas de produto mudam o estoque (E9): lista, histórico do produto e card do Início.
    revalidatePath("/estoque");
    revalidatePath("/estoque/[id]", "page");
    revalidatePath("/");
  }
  return r;
}

export async function createOrderAction(input: unknown): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.createOrder(db, input));
}

export async function updateOrderAction(
  id: number,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.updateOrder(db, id, input));
}

export async function addServiceItemAction(
  orderId: number,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.addServiceItem(db, orderId, input));
}

/** Produto vendido (E9): `{ productId, quantity?, unitPriceCents? }`. Em OS concluída baixa na hora. */
export async function addProductItemAction(
  orderId: number,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.addProductItem(db, orderId, input));
}

/** Altera quantidade/preço de item de serviço ou produto. */
export async function updateOrderItemAction(
  itemId: number,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.updateOrderItem(db, itemId, input));
}

/** Remove item de serviço ou produto (produto de OS concluída volta ao estoque). */
export async function removeOrderItemAction(itemId: number): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.removeOrderItem(db, itemId));
}

/** `payments` vazio = Fiado. */
export async function completeOrderAction(
  orderId: number,
  payments: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.completeOrder(db, orderId, payments));
}

export async function cancelOrderAction(orderId: number): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.cancelOrder(db, orderId));
}

export async function registerPaymentAction(
  orderId: number,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.registerPayment(db, orderId, input));
}

export async function deletePaymentAction(paymentId: number): Promise<ActionResult<OrderDetail>> {
  await requireSession();
  return refresh(await domain.deletePayment(db, paymentId));
}

/** Exclusão definitiva (D-47): só atendimento cancelado e sem pagamentos. */
export async function deleteOrderAction(
  orderId: number,
): Promise<ActionResult<{ id: number; customerId: number }>> {
  await requireSession();
  const r = await domain.deleteOrder(db, orderId);
  if (r.ok) {
    revalidatePath("/atendimentos");
    revalidatePath("/caixa");
    revalidatePath(`/clientes/${r.data.customerId}`);
  }
  return r;
}

/**
 * Receber do cliente (E6, D-48): distribui do atendimento mais antigo para o mais novo.
 * `input`: { amountCents, method: CASH|PIX|DEBIT_CARD|CREDIT_CARD, occurredAt? (ISO com offset) }.
 */
export async function receiveFromCustomerAction(
  customerId: number,
  input: unknown,
): Promise<ActionResult<ReceiveResult>> {
  await requireSession();
  const r = await receiveFromCustomer(db, customerId, input);
  if (r.ok) {
    revalidatePath("/fiado");
    revalidatePath("/atendimentos");
    revalidatePath("/caixa");
    revalidatePath(`/clientes/${customerId}`);
    for (const d of r.data.distribution) revalidatePath(`/atendimentos/${d.orderId}`);
  }
  return r;
}
