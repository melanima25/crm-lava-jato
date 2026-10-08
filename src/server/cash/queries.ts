// Consultas do caixa para Server Components (leitura). Exigem sessão válida.
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";

export type {
  CashCategoryDTO,
  CashEntryDTO,
  CashEntryList,
  CashSummary,
  MethodTotals,
} from "./domain";
export type { PeriodPreset, ResolvedPeriod } from "./period";

/**
 * Resumo do período. `input`: { preset?: "today"|"week"|"month"|"custom", from?, to? } ("yyyy-mm-dd",
 * dia em São Paulo; padrão hoje; inválido = hoje). Saldo acumulado = tudo até o fim do período.
 */
export async function getCashSummary(input: unknown = {}) {
  await requireSession();
  return domain.getCashSummary(db, input);
}

/**
 * Extrato (mais recente primeiro). `input`: período + { direction?, categoryId? (id | "ORDERS"),
 * method?, q?, page? (1..), limit? (1..200, padrão 50) }.
 */
export async function listCashEntries(input: unknown = {}) {
  await requireSession();
  return domain.listCashEntries(db, input);
}

/** Um lançamento (para a tela de edição) ou null. */
export async function getCashEntry(id: number) {
  await requireSession();
  return domain.getCashEntry(db, id);
}

/**
 * Categorias. Padrão: só ativas (formulário de lançamento: passe `direction`). `includeInactive`
 * para /caixa/categorias. Garante as categorias de sistema.
 */
export async function listCashCategories(
  input: { direction?: "IN" | "OUT"; includeInactive?: boolean } = {},
) {
  await requireSession();
  return domain.listCashCategories(db, input);
}
