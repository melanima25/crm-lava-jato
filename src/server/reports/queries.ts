// Consultas dos relatórios (E10) para Server Components (leitura). Exigem sessão válida.
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import * as domain from "./domain";

export type {
  ReportPeriod,
  SalesReport,
  SalesRow,
  TopCustomerRow,
  TopCustomersReport,
  TopItemKind,
  TopItemRow,
  TopItemSort,
  TopItemsReport,
} from "./domain";

/**
 * Vendas do período. `period`: { preset?: "today"|"week"|"month"|"lastMonth"|"custom", from?, to? }
 * ("yyyy-mm-dd", dia em São Paulo; padrão hoje; inválido = hoje; personalizado acima de 366 dias é
 * encurtado e `period.truncated` vem true).
 */
export async function getSalesReport(period: unknown = {}) {
  await requireSession();
  return domain.getSalesReport(db, period);
}

/** Ranking de serviços (`kind` "SERVICE") ou produtos ("PRODUCT"); `sort` "quantity" (padrão) ou "value". */
export async function getTopItems(
  period: unknown = {},
  kind: domain.TopItemKind = "SERVICE",
  sort: domain.TopItemSort = "quantity",
) {
  await requireSession();
  return domain.getTopItems(db, period, kind, sort);
}

/** Top 20 clientes por visitas (desempate: valor) no período. */
export async function getTopCustomers(period: unknown = {}) {
  await requireSession();
  return domain.getTopCustomers(db, period);
}
