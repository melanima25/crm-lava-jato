// Relatórios (E10, D-61..D-63): só leitura. Sem cookies/Next: recebe o cliente Prisma. Dinheiro em centavos.
//
//  - Vendido (competência) = Σ totalCents das OS DONE com occurredAt no período (inclui o fiado).
//  - Recebido (caixa) = Σ CashEntry com serviceOrderId e occurredAt no período, qualquer que seja a data
//    da OS; `receivedFromPriorCents` = parte cuja OS é anterior ao início do período.
//  - Ficou no fiado = Σ (totalCents − paidCents) das OS do Vendido, na situação atual.
//  - OS CANCELED e OPEN ficam fora de tudo. Agrupamento por dia/mês em America/Sao_Paulo feito em
//    TypeScript (ymdBR), sem funções de data do SQL (diferem entre SQLite e Postgres).
import { addDaysYmd, ymdBR } from "@/lib/dates";
import { resolvePeriod, type PeriodPreset, type ResolvedPeriod } from "@/server/cash/period";
import { periodInputSchema } from "@/server/cash/schemas";
import { getDebtByCustomer } from "@/server/orders/debt-balance";
import type { Client } from "@/server/orders/domain";

/** Período personalizado máximo (dias corridos, inclusive). */
export const MAX_REPORT_DAYS = 366;
/** Acima disso a tabela agrupa por mês em vez de por dia. */
export const DAILY_TABLE_MAX_DAYS = 62;
export const TOP_CUSTOMERS_LIMIT = 20;

export type ReportPeriod = {
  preset: PeriodPreset;
  /** "yyyy-mm-dd" (dia em São Paulo) */
  fromYmd: string;
  toYmd: string;
  /** Nº de dias do período (inclusive). */
  days: number;
  /** true = o período personalizado passava de 366 dias e foi encurtado (mantém o fim). */
  truncated: boolean;
};

export type ReportRange = ResolvedPeriod & { days: number; truncated: boolean };

function daysBetween(fromYmd: string, toYmd: string): number {
  const [a, b] = [fromYmd, toYmd].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Resolve o período (D-53 + "lastMonth"); personalizado acima de 366 dias é encurtado, mantendo o fim. */
export function resolveReportPeriod(input: unknown, now: Date = new Date()): ReportRange {
  const p = periodInputSchema.safeParse(input ?? {});
  let per = resolvePeriod(p.success ? p.data : {}, now);
  let days = daysBetween(per.fromYmd, per.toYmd);
  let truncated = false;
  if (per.preset === "custom" && days > MAX_REPORT_DAYS) {
    const fromYmd = addDaysYmd(per.toYmd, -(MAX_REPORT_DAYS - 1));
    per = resolvePeriod({ from: fromYmd, to: per.toYmd }, now);
    days = MAX_REPORT_DAYS;
    truncated = true;
  }
  return { ...per, days, truncated };
}

function toReportPeriod(r: ReportRange): ReportPeriod {
  return {
    preset: r.preset,
    fromYmd: r.fromYmd,
    toYmd: r.toYmd,
    days: r.days,
    truncated: r.truncated,
  };
}

// ---------- Vendas ----------

export type SalesRow = {
  /** "yyyy-mm-dd" (granularity "day") ou "yyyy-mm" ("month"), em São Paulo. */
  key: string;
  ordersCount: number;
  soldCents: number;
  receivedCents: number;
};

export type SalesReport = {
  period: ReportPeriod;
  soldCents: number;
  receivedCents: number;
  /** Parte do Recebido que paga atendimentos anteriores ao início do período. */
  receivedFromPriorCents: number;
  /** Ficou no fiado (situação atual) das OS do Vendido. */
  pendingCents: number;
  ordersCount: number;
  /** Vendido ÷ atendimentos, arredondado ao centavo; null se não houve atendimentos. */
  averageTicketCents: number | null;
  /** Σ descontos das OS do Vendido (informativo; o Vendido já é líquido). */
  discountCents: number;
  granularity: "day" | "month";
  /** Só buckets com movimento, em ordem cronológica. */
  rows: SalesRow[];
};

export async function getSalesReport(
  db: Client,
  input: unknown = {},
  now: Date = new Date(),
): Promise<SalesReport> {
  const per = resolveReportPeriod(input, now);
  const range = { gte: per.from, lte: per.to };

  const [orders, payments] = await Promise.all([
    db.serviceOrder.findMany({
      where: { status: "DONE", occurredAt: range },
      select: { occurredAt: true, totalCents: true, paidCents: true, discountCents: true },
    }),
    db.cashEntry.findMany({
      where: { serviceOrderId: { not: null }, direction: "IN", occurredAt: range },
      select: {
        amountCents: true,
        occurredAt: true,
        serviceOrder: { select: { occurredAt: true } },
      },
    }),
  ]);

  const granularity = per.days > DAILY_TABLE_MAX_DAYS ? "month" : "day";
  const keyOf = (d: Date) => (granularity === "day" ? ymdBR(d) : ymdBR(d).slice(0, 7));
  const buckets = new Map<string, SalesRow>();
  const bucket = (key: string) => {
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { key, ordersCount: 0, soldCents: 0, receivedCents: 0 }));
    return b;
  };

  let soldCents = 0;
  let pendingCents = 0;
  let discountCents = 0;
  for (const o of orders) {
    soldCents += o.totalCents;
    pendingCents += Math.max(0, o.totalCents - o.paidCents);
    discountCents += o.discountCents;
    const b = bucket(keyOf(o.occurredAt));
    b.ordersCount += 1;
    b.soldCents += o.totalCents;
  }

  let receivedCents = 0;
  let receivedFromPriorCents = 0;
  for (const p of payments) {
    receivedCents += p.amountCents;
    if (p.serviceOrder && p.serviceOrder.occurredAt.getTime() < per.from.getTime()) {
      receivedFromPriorCents += p.amountCents;
    }
    bucket(keyOf(p.occurredAt)).receivedCents += p.amountCents;
  }

  const ordersCount = orders.length;
  return {
    period: toReportPeriod(per),
    soldCents,
    receivedCents,
    receivedFromPriorCents,
    pendingCents,
    ordersCount,
    averageTicketCents: ordersCount > 0 ? Math.round(soldCents / ordersCount) : null,
    discountCents,
    granularity,
    rows: [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

// ---------- Rankings de serviços / produtos ----------

export type TopItemKind = "SERVICE" | "PRODUCT";
export type TopItemSort = "quantity" | "value";

export type TopItemRow = {
  /** serviceId / productId; null só se o item perdeu o vínculo (agrupa pela descrição). */
  id: number | null;
  /** Nome ATUAL do catálogo (descrição do item só como último recurso). */
  name: string;
  quantity: number;
  /** Nº de atendimentos distintos. */
  ordersCount: number;
  /** Σ item.totalCents, sem ratear o desconto da OS. */
  grossCents: number;
  /** Só para serviços (kind SERVICE); em produtos fica null. Itens de OS sem veículo não entram aqui. */
  byVehicle: {
    car: { quantity: number; grossCents: number };
    motorcycle: { quantity: number; grossCents: number };
  } | null;
};

export type TopItemsReport = {
  period: ReportPeriod;
  kind: TopItemKind;
  sort: TopItemSort;
  rows: TopItemRow[];
  /** Σ descontos das OS DONE do período (rodapé: o ranking é bruto). */
  discountCents: number;
};

export async function getTopItems(
  db: Client,
  input: unknown = {},
  kind: TopItemKind = "SERVICE",
  sort: TopItemSort = "quantity",
  now: Date = new Date(),
): Promise<TopItemsReport> {
  const per = resolveReportPeriod(input, now);
  const orderWhere = { status: "DONE" as const, occurredAt: { gte: per.from, lte: per.to } };
  const kindOk: TopItemKind = kind === "PRODUCT" ? "PRODUCT" : "SERVICE";
  const sortOk: TopItemSort = sort === "value" ? "value" : "quantity";

  const [items, discount] = await Promise.all([
    db.serviceOrderItem.findMany({
      where: { kind: kindOk, order: orderWhere },
      select: {
        orderId: true,
        serviceId: true,
        productId: true,
        description: true,
        quantity: true,
        totalCents: true,
        service: { select: { name: true } },
        product: { select: { name: true } },
        order: { select: { vehicle: { select: { type: true } } } },
      },
    }),
    db.serviceOrder.aggregate({ where: orderWhere, _sum: { discountCents: true } }),
  ]);

  type Acc = TopItemRow & { orders: Set<number> };
  const acc = new Map<string, Acc>();
  for (const it of items) {
    const id = kindOk === "SERVICE" ? it.serviceId : it.productId;
    const key = id !== null ? `i:${id}` : `d:${it.description}`;
    const name = (kindOk === "SERVICE" ? it.service?.name : it.product?.name) ?? it.description;
    let a = acc.get(key);
    if (!a) {
      a = {
        id,
        name,
        quantity: 0,
        ordersCount: 0,
        grossCents: 0,
        byVehicle:
          kindOk === "SERVICE"
            ? {
                car: { quantity: 0, grossCents: 0 },
                motorcycle: { quantity: 0, grossCents: 0 },
              }
            : null,
        orders: new Set(),
      };
      acc.set(key, a);
    }
    a.quantity += it.quantity;
    a.grossCents += it.totalCents;
    a.orders.add(it.orderId);
    const vt = it.order.vehicle?.type;
    if (a.byVehicle && vt) {
      const slot = vt === "MOTORCYCLE" ? a.byVehicle.motorcycle : a.byVehicle.car;
      slot.quantity += it.quantity;
      slot.grossCents += it.totalCents;
    }
  }

  const rows: TopItemRow[] = [...acc.values()].map(({ orders, ...r }) => ({
    ...r,
    ordersCount: orders.size,
  }));
  rows.sort((a, b) => {
    const primary = sortOk === "quantity" ? b.quantity - a.quantity : b.grossCents - a.grossCents;
    if (primary !== 0) return primary;
    const secondary = sortOk === "quantity" ? b.grossCents - a.grossCents : b.quantity - a.quantity;
    return secondary !== 0 ? secondary : a.name.localeCompare(b.name, "pt-BR");
  });

  return {
    period: toReportPeriod(per),
    kind: kindOk,
    sort: sortOk,
    rows,
    discountCents: discount._sum.discountCents ?? 0,
  };
}

// ---------- Clientes mais frequentes ----------

export type TopCustomerRow = {
  customerId: number;
  name: string;
  active: boolean;
  /** Nº de OS DONE no período. */
  visits: number;
  /** Σ totalCents das OS DONE no período. */
  totalCents: number;
  lastVisitAt: Date;
  /** Saldo devedor atual (D-48), de todas as OS, não só do período. */
  debtCents: number;
};

export type TopCustomersReport = {
  period: ReportPeriod;
  rows: TopCustomerRow[];
};

export async function getTopCustomers(
  db: Client,
  input: unknown = {},
  now: Date = new Date(),
): Promise<TopCustomersReport> {
  const per = resolveReportPeriod(input, now);
  const orders = await db.serviceOrder.findMany({
    where: { status: "DONE", occurredAt: { gte: per.from, lte: per.to } },
    select: {
      customerId: true,
      totalCents: true,
      occurredAt: true,
      customer: { select: { name: true, active: true } },
    },
  });

  const acc = new Map<number, TopCustomerRow>();
  for (const o of orders) {
    let r = acc.get(o.customerId);
    if (!r) {
      r = {
        customerId: o.customerId,
        name: o.customer.name,
        active: o.customer.active,
        visits: 0,
        totalCents: 0,
        lastVisitAt: o.occurredAt,
        debtCents: 0,
      };
      acc.set(o.customerId, r);
    }
    r.visits += 1;
    r.totalCents += o.totalCents;
    if (o.occurredAt.getTime() > r.lastVisitAt.getTime()) r.lastVisitAt = o.occurredAt;
  }

  const rows = [...acc.values()]
    .sort(
      (a, b) =>
        b.visits - a.visits ||
        b.totalCents - a.totalCents ||
        a.name.localeCompare(b.name, "pt-BR") ||
        a.customerId - b.customerId,
    )
    .slice(0, TOP_CUSTOMERS_LIMIT);

  const debts = await getDebtByCustomer(
    db,
    rows.map((r) => r.customerId),
  );
  for (const r of rows) r.debtCents = debts.get(r.customerId) ?? 0;

  return { period: toReportPeriod(per), rows };
}
