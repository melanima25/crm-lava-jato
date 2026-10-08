// Fiado (E6, D-48..D-50): consultas de saldo devedor e "Receber do cliente". Sem cookies/Next.
//
// Regras:
//  - Saldo devedor = Σ(totalCents − paidCents) das OS DONE do cliente (derivado, nunca digitado).
//  - Receber distribui do atendimento MAIS ANTIGO para o mais novo; um CashEntry por OS afetada;
//    o que sobrar fica parcial na última. Toda escrita passa por `addPaymentEntry`/`recalcOrder`.
import { customerSearchWhere } from "@/server/customers/domain";
import { pendingOrdersWhere } from "./debt-balance";
import {
  addPaymentEntry,
  DomainError,
  fail,
  lockOrder,
  MSG,
  paymentStatusOf,
  recalcOrder,
  run,
  zodFail,
  type ActionResult,
  type Client,
  type Db,
  type OrderVehicleSummary,
  type PaymentStatus,
} from "./domain";
import { addPaymentSchema, debtorsFilterSchema, idSchema } from "./schemas";

export type DebtorItem = {
  customerId: number;
  name: string;
  phone: string | null;
  active: boolean;
  /** Σ saldo das OS pendentes (> 0). */
  balanceCents: number;
  pendingCount: number;
  /** `occurredAt` do atendimento pendente mais antigo. */
  oldestPendingAt: Date;
};

export type DebtorList = {
  debtors: DebtorItem[];
  /** Total em aberto dos clientes listados (respeita a busca). */
  totalCents: number;
  /** Total geral em aberto de TODOS os clientes (ignora a busca). */
  grandTotalCents: number;
};

export type PendingOrderDTO = {
  id: number;
  occurredAt: Date;
  completedAt: Date | null;
  vehicle: OrderVehicleSummary | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** "UNPAID" ou "PARTIAL" (pendente nunca é "PAID"). */
  paymentStatus: PaymentStatus;
};

export type CustomerDebt = {
  customerId: number;
  customerName: string;
  balanceCents: number;
  pendingCount: number;
  oldestPendingAt: Date | null;
  /** Mais antiga -> mais nova (a ordem em que um recebimento será distribuído). */
  orders: PendingOrderDTO[];
};

export type ReceiveResult = {
  customerId: number;
  receivedCents: number;
  /** Na ordem de distribuição (mais antiga primeiro). */
  distribution: { orderId: number; amountCents: number; orderBalanceCents: number }[];
  /** Saldo devedor total do cliente depois do recebimento. */
  balanceCents: number;
};

const MSG_DEBT = {
  noDebt: "Este cliente não tem saldo devedor",
  aboveDebt: "O valor é maior que o saldo devedor do cliente",
} as const;

/**
 * Ordem canônica das pendências (D-48): `occurredAt` do atendimento ascendente, `id` como desempate.
 * É a mesma ordem exibida em `getCustomerDebt` e usada na distribuição.
 */
const PENDING_ORDER_BY = [{ occurredAt: "asc" }, { id: "asc" }] as const;

// ---------- Consultas ----------

/**
 * Clientes com saldo devedor > 0 (inclui clientes inativos: a dívida continua valendo).
 * `sort`: "oldest" (padrão; atendimento pendente mais antigo primeiro, desempate maior saldo, id) ou
 * "balance" (maior saldo primeiro, desempate mais antigo, id). `q` usa a busca de clientes
 * (nome sem acento, telefone, placa).
 */
export async function listDebtors(db: Client, input: unknown = {}): Promise<DebtorList> {
  const f = debtorsFilterSchema.safeParse(input);
  const { q, sort } = f.success ? f.data : { q: "", sort: "oldest" as const };
  const grand = await db.serviceOrder.findMany({
    where: pendingOrdersWhere(db),
    select: { totalCents: true, paidCents: true },
  });
  const grandTotalCents = grand.reduce((a, o) => a + (o.totalCents - o.paidCents), 0);

  const filter = customerSearchWhere(q);
  if (filter === null) return { debtors: [], totalCents: 0, grandTotalCents };

  const rows = await db.serviceOrder.findMany({
    where: pendingOrdersWhere(db, { customer: filter }),
    orderBy: [...PENDING_ORDER_BY],
    select: {
      occurredAt: true,
      totalCents: true,
      paidCents: true,
      customer: { select: { id: true, name: true, phone: true, active: true } },
    },
  });
  const byCustomer = new Map<number, DebtorItem>();
  for (const r of rows) {
    const cur = byCustomer.get(r.customer.id);
    const balance = r.totalCents - r.paidCents;
    if (cur) {
      cur.balanceCents += balance;
      cur.pendingCount += 1; // rows já vêm do mais antigo: oldestPendingAt não muda
    } else {
      byCustomer.set(r.customer.id, {
        customerId: r.customer.id,
        name: r.customer.name,
        phone: r.customer.phone,
        active: r.customer.active,
        balanceCents: balance,
        pendingCount: 1,
        oldestPendingAt: r.occurredAt,
      });
    }
  }
  const debtors = [...byCustomer.values()].sort((a, b) => {
    const byAge = a.oldestPendingAt.getTime() - b.oldestPendingAt.getTime();
    const byBalance = b.balanceCents - a.balanceCents;
    const first = sort === "balance" ? byBalance : byAge;
    const second = sort === "balance" ? byAge : byBalance;
    return first || second || a.customerId - b.customerId;
  });
  return {
    debtors,
    totalCents: debtors.reduce((a, d) => a + d.balanceCents, 0),
    grandTotalCents,
  };
}

/** Saldo + pendências do cliente (mais antiga -> mais nova). null se o cliente não existir. */
export async function getCustomerDebt(
  db: Client,
  customerId: unknown,
): Promise<CustomerDebt | null> {
  const cid = idSchemaOrFail(customerId);
  if (cid === null) return null;
  const c = await db.customer.findUnique({ where: { id: cid }, select: { id: true, name: true } });
  if (!c) return null;
  return loadCustomerDebt(db, c.id, c.name);
}

async function loadCustomerDebt(db: Client, id: number, name: string): Promise<CustomerDebt> {
  const rows = await db.serviceOrder.findMany({
    where: pendingOrdersWhere(db, { customerId: id }),
    orderBy: [...PENDING_ORDER_BY],
    include: {
      vehicle: {
        select: { id: true, type: true, plate: true, brand: true, model: true, color: true },
      },
    },
  });
  const orders: PendingOrderDTO[] = rows.map((o) => ({
    id: o.id,
    occurredAt: o.occurredAt,
    completedAt: o.completedAt,
    vehicle: o.vehicle,
    totalCents: o.totalCents,
    paidCents: o.paidCents,
    balanceCents: o.totalCents - o.paidCents,
    paymentStatus: paymentStatusOf("DONE", o.totalCents, o.paidCents) as PaymentStatus,
  }));
  return {
    customerId: id,
    customerName: name,
    balanceCents: orders.reduce((a, o) => a + o.balanceCents, 0),
    pendingCount: orders.length,
    oldestPendingAt: orders[0]?.occurredAt ?? null,
    orders,
  };
}

// ---------- Escrita ----------

/**
 * Receber do cliente (D-48..D-50). Valida valor (inteiro > 0), forma (sem "Fiado") e data (não
 * futura). Na transação: trava as OS pendentes do cliente em ordem de id crescente (sem deadlock
 * entre recebimentos concorrentes), relê as pendências e os saldos DEPOIS do lock, rejeita valor >
 * saldo total e distribui do mais antigo (occurredAt, id) para o mais novo.
 */
export async function receiveFromCustomer(
  db: Db,
  customerId: unknown,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<ReceiveResult>> {
  const cid = idSchemaOrFail(customerId);
  if (cid === null) return fail(MSG.invalidId);
  const p = addPaymentSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const { amountCents, method } = p.data;
  const occurredAt = p.data.occurredAt ?? now;
  if (occurredAt.getTime() > now.getTime()) {
    return fail(MSG.futureDate, { occurredAt: MSG.futureDate });
  }

  return run(db, async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: cid }, select: { id: true } });
    if (!customer) throw new DomainError(MSG.customerNotFound);

    // 1) Trava as pendências (id crescente) até o conjunto ficar estável.
    const locked = new Set<number>();
    let pending: { id: number }[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      pending = await tx.serviceOrder.findMany({
        where: pendingOrdersWhere(tx, { customerId: cid }),
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const fresh = pending.filter((o) => !locked.has(o.id));
      if (fresh.length === 0) break;
      for (const o of fresh) {
        await lockOrder(tx, o.id);
        locked.add(o.id);
      }
    }

    // 2) Relê saldos depois do lock (recalcOrder reconstrói do caixa) e ordena do mais antigo.
    const fresh = await tx.serviceOrder.findMany({
      where: { id: { in: [...locked] }, status: "DONE", customerId: cid },
      orderBy: [...PENDING_ORDER_BY],
      select: { id: true },
    });
    const balances: { id: number; balance: number }[] = [];
    for (const o of fresh) {
      const r = await recalcOrder(tx, o.id);
      if (r.totalCents > r.paidCents)
        balances.push({ id: o.id, balance: r.totalCents - r.paidCents });
    }
    const debt = balances.reduce((a, b) => a + b.balance, 0);
    if (debt <= 0) throw new DomainError(MSG_DEBT.noDebt);
    if (amountCents > debt) {
      throw new DomainError(MSG_DEBT.aboveDebt, { amountCents: MSG_DEBT.aboveDebt });
    }

    // 3) Distribui (mais antigo -> mais novo), um CashEntry por OS afetada.
    let remaining = amountCents;
    const distribution: ReceiveResult["distribution"] = [];
    for (const b of balances) {
      if (remaining <= 0) break;
      const part = Math.min(remaining, b.balance);
      await addPaymentEntry(tx, b.id, part, method, occurredAt);
      distribution.push({ orderId: b.id, amountCents: part, orderBalanceCents: b.balance - part });
      remaining -= part;
    }
    return {
      customerId: cid,
      receivedCents: amountCents,
      distribution,
      balanceCents: debt - amountCents,
    };
  });
}

function idSchemaOrFail(v: unknown): number | null {
  const r = idSchema.safeParse(v);
  return r.success ? r.data : null;
}
