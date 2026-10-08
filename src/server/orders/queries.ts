// Consultas para Server Components (leitura). Exigem sessão válida.
import { requireSession } from "@/server/auth/require-session";
import { db } from "@/server/db";
import { getCustomerDebt as getCustomerDebtDomain, listDebtors as listDebtorsDomain } from "./debt";
import * as domain from "./domain";

export type {
  DayCash,
  OrderDetail,
  OrderListItem,
  PaymentStatus,
  ProductForSale,
  ServiceForVehicle,
} from "./domain";

type ListInput = {
  /** "yyyy-mm-dd"; padrão hoje (America/Sao_Paulo). Inválida = hoje. */
  date?: string;
  /** Fim inclusivo do intervalo. */
  dateTo?: string;
  status?: "OPEN" | "DONE" | "CANCELED";
  customerId?: number;
};

export async function listOrders(input: ListInput = {}) {
  await requireSession();
  return domain.listOrders(db, input);
}

/** Detalhe ou null se não existir (use notFound()). */
export async function getOrder(id: number) {
  await requireSession();
  return domain.getOrderDetail(db, id);
}

/** Caixa do dia: pagamentos de OS recebidos na data, total por forma e total geral. */
export async function getDayCash(input: { date?: string } = {}) {
  await requireSession();
  return domain.getDayCash(db, input);
}

/** Serviços ativos oferecidos ao tipo do veículo, com `suggestedPriceCents`. */
export async function listServicesForVehicleType(vehicleType: "CAR" | "MOTORCYCLE", q = "") {
  await requireSession();
  return domain.listServicesForVehicleType(db, { vehicleType, q });
}

/** Produtos ativos com preço de venda e estoque atual (venda no atendimento, E9). */
export async function listProductsForSale() {
  await requireSession();
  return domain.listProductsForSale(db);
}

export type { CustomerDebt, DebtorItem, DebtorList, PendingOrderDTO } from "./debt";

/**
 * /fiado: clientes com saldo devedor > 0. `sort`: "oldest" (padrão, atendimento pendente mais
 * antigo primeiro) ou "balance" (maior saldo primeiro). `q`: nome/telefone/placa.
 */
export async function listDebtors(input: { q?: string; sort?: "oldest" | "balance" } = {}) {
  await requireSession();
  return listDebtorsDomain(db, input);
}

/** Saldo + OS pendentes (mais antiga -> mais nova) do cliente; null se não existir. */
export async function getCustomerDebt(customerId: number) {
  await requireSession();
  return getCustomerDebtDomain(db, customerId);
}
