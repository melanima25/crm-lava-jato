"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";
import type { ActionResult, ProductDTO, ServiceDTO } from "./domain";

// Toda action exige sessão válida; sem ela redireciona para /login.

function refresh<T>(r: ActionResult<T>, path: "/servicos" | "/produtos"): ActionResult<T> {
  if (r.ok) revalidatePath(path);
  return r;
}

export async function createServiceAction(input: unknown): Promise<ActionResult<ServiceDTO>> {
  await requireSession();
  return refresh(await domain.createService(db, input), "/servicos");
}

export async function updateServiceAction(
  id: number,
  input: unknown,
): Promise<ActionResult<ServiceDTO>> {
  await requireSession();
  return refresh(await domain.updateService(db, id, input), "/servicos");
}

export async function setServiceActiveAction(
  id: number,
  active: boolean,
): Promise<ActionResult<ServiceDTO>> {
  await requireSession();
  return refresh(await domain.setServiceActive(db, id, active), "/servicos");
}

export async function deleteServiceAction(id: number): Promise<ActionResult<{ id: number }>> {
  await requireSession();
  return refresh(await domain.deleteService(db, id), "/servicos");
}

export async function createProductAction(input: unknown): Promise<ActionResult<ProductDTO>> {
  await requireSession();
  return refresh(await domain.createProduct(db, input), "/produtos");
}

export async function updateProductAction(
  id: number,
  input: unknown,
): Promise<ActionResult<ProductDTO>> {
  await requireSession();
  return refresh(await domain.updateProduct(db, id, input), "/produtos");
}

export async function setProductActiveAction(
  id: number,
  active: boolean,
): Promise<ActionResult<ProductDTO>> {
  await requireSession();
  return refresh(await domain.setProductActive(db, id, active), "/produtos");
}

export async function deleteProductAction(id: number): Promise<ActionResult<{ id: number }>> {
  await requireSession();
  return refresh(await domain.deleteProduct(db, id), "/produtos");
}
