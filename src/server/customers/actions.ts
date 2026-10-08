"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";
import type { ActionResult, CustomerDTO, VehicleDTO } from "./domain";

// Toda action exige sessão válida; sem ela redireciona para /login.

function refresh<T>(r: ActionResult<T>, customerId?: number): ActionResult<T> {
  if (r.ok) {
    revalidatePath("/clientes");
    if (customerId) revalidatePath(`/clientes/${customerId}`);
  }
  return r;
}

export async function createCustomerAction(input: unknown): Promise<ActionResult<CustomerDTO>> {
  await requireSession();
  const r = await domain.createCustomer(db, input);
  return refresh(r, r.ok ? r.data.id : undefined);
}

export async function updateCustomerAction(
  id: number,
  input: unknown,
): Promise<ActionResult<CustomerDTO>> {
  await requireSession();
  const r = await domain.updateCustomer(db, id, input);
  return refresh(r, r.ok ? r.data.id : undefined);
}

export async function setCustomerActiveAction(
  id: number,
  active: boolean,
): Promise<ActionResult<CustomerDTO>> {
  await requireSession();
  const r = await domain.setCustomerActive(db, id, active);
  return refresh(r, r.ok ? r.data.id : undefined);
}

/** Exclusão definitiva (D-47): só cliente sem atendimentos; exclui os veículos junto. */
export async function deleteCustomerAction(id: number): Promise<ActionResult<{ id: number }>> {
  await requireSession();
  const r = await domain.deleteCustomer(db, id);
  if (r.ok) {
    revalidatePath("/clientes");
    revalidatePath("/atendimentos");
  }
  return r;
}

export async function createVehicleAction(
  customerId: number,
  input: unknown,
): Promise<ActionResult<VehicleDTO>> {
  await requireSession();
  return refresh(await domain.createVehicle(db, customerId, input), customerId);
}

export async function updateVehicleAction(
  id: number,
  input: unknown,
): Promise<ActionResult<VehicleDTO>> {
  await requireSession();
  const r = await domain.updateVehicle(db, id, input);
  return refresh(r, r.ok ? r.data.customerId : undefined);
}

export async function setVehicleActiveAction(
  id: number,
  active: boolean,
): Promise<ActionResult<VehicleDTO>> {
  await requireSession();
  const r = await domain.setVehicleActive(db, id, active);
  return refresh(r, r.ok ? r.data.customerId : undefined);
}
