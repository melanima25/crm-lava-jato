// Consultas do estoque para Server Components (leitura). Exigem sessão válida.
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";

export type { LowStockSummary, StockHistory, StockMovementDTO, StockProductDTO } from "./domain";

/** `{ q?, includeInactive?, lowOnly? }`; ordenada por nome; busca sem acento/caixa. */
export async function listStock(
  input: { q?: string; includeInactive?: boolean; lowOnly?: boolean } = {},
) {
  await requireSession();
  return domain.searchStock(db, input);
}

/** Produto + histórico paginado (`{ page?, limit? }`). `null` se o produto não existir (use notFound()). */
export async function getProductStock(
  productId: number,
  paging: { page?: number; limit?: number } = {},
) {
  await requireSession();
  return domain.getProductStockHistory(db, productId, paging);
}

/** Produtos ativos em estoque baixo (estoque <= mínimo), para o card do Início. */
export async function getLowStock() {
  await requireSession();
  return domain.getLowStockSummary(db);
}
