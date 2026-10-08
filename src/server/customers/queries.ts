// Consultas para Server Components (leitura). Exigem sessão válida.
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";

export type { CustomerDetail, CustomerListItem } from "./domain";

/** `input`: { q?: string; includeInactive?: boolean }. Ordenado por nome. */
export async function listCustomers(input: { q?: string; includeInactive?: boolean } = {}) {
  await requireSession();
  return domain.searchCustomers(db, input);
}

/** Cliente + veículos, ou null se não existir (use notFound()). */
export async function getCustomer(id: number) {
  await requireSession();
  return domain.getCustomerDetail(db, id);
}
