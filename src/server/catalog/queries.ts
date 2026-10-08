// Consultas para Server Components (leitura). Exigem sessão válida.
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";

export type { ProductDTO, ServiceDTO } from "./domain";

type ListInput = { q?: string; includeInactive?: boolean };

/** Ordenado por nome; padrão só ativos. Busca sem acento/caixa. */
export async function listServices(input: ListInput = {}) {
  await requireSession();
  return domain.searchServices(db, input);
}

/** Serviço ou null se não existir (use notFound()). */
export async function getService(id: number) {
  await requireSession();
  return domain.getServiceById(db, id);
}

export async function listProducts(input: ListInput = {}) {
  await requireSession();
  return domain.searchProducts(db, input);
}

export async function getProduct(id: number) {
  await requireSession();
  return domain.getProductById(db, id);
}
