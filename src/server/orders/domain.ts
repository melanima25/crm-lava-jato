// Regras de negócio de atendimentos (OS), itens e pagamentos. Sem cookies/Next: recebe o cliente Prisma.
//
// Regras centrais (docs/modelo-dados.md, D-13, D-16, D-28, D-36..D-40):
//  - `recalcOrder` é a ÚNICA função que grava totalCents/paidCents; toda escrita que altera itens,
//    desconto ou pagamentos roda numa `$transaction` e termina chamando-a. Ela também valida os
//    invariantes (desconto <= subtotal, total >= pago) e desfaz a transação se forem violados.
//  - Pagamento = CashEntry IN com serviceOrderId. "Fiado" não existe no banco: é lista vazia.
//  - Estoque (E9, D-15): só itens PRODUCT de OS concluída geram baixa SALE (uma por item). Concluir cria as
//    baixas; adicionar/alterar/remover item PRODUCT em OS DONE ajusta a baixa; cancelar OS DONE exclui todas.
//    Serviço nunca mexe no estoque; OS OPEN também não. `Product.stockQuantity` é sempre escrito por
//    `recomputeProductStock` (stock/domain). Ordem dos locks: OS primeiro, depois produtos por id crescente.
//  - `deleteOrder` (D-47) exclui só OS cancelada sem caixa; não toca estoque (cancelada não tem baixa).
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { isPostgresUrl } from "@/server/db-adapter";
import { endOfDayBR, parseDateBR, startOfDayBR } from "@/lib/dates";
import { searchServices, type ServiceDTO } from "@/server/catalog/domain";
import { lockProduct, recomputeProductStock, sumProductStock } from "@/server/stock/domain";
import {
  addPaymentSchema,
  createOrderSchema,
  dayCashSchema,
  idSchema,
  listOrdersSchema,
  newItemSchema,
  newProductItemSchema,
  paymentLinesSchema,
  updateItemSchema,
  updateOrderSchema,
  vehicleTypeInputSchema,
} from "./schemas";

export type Db = PrismaClient;
/** Cliente de transação (ou o próprio PrismaClient, que é atribuível a ele). */
export type Client = Prisma.TransactionClient;

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type VehicleType = "CAR" | "MOTORCYCLE";
export type OrderStatus = "OPEN" | "DONE" | "CANCELED";
export type PaymentMethod = "CASH" | "PIX" | "DEBIT_CARD" | "CREDIT_CARD";
/** Derivado; só existe para OS concluída (null em OPEN/CANCELED). */
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

export type OrderVehicleSummary = {
  id: number;
  type: VehicleType;
  plate: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
};

export type OrderListItem = {
  id: number;
  status: OrderStatus;
  occurredAt: Date;
  customer: { id: number; name: string };
  vehicle: OrderVehicleSummary | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  paymentStatus: PaymentStatus | null;
};

export type OrderItemDTO = {
  id: number;
  kind: "SERVICE" | "PRODUCT";
  serviceId: number | null;
  productId: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  /** Só PRODUCT: unidade e estoque atual do produto (informativo). */
  unit: string | null;
  stockQuantity: number | null;
};

export type OrderPaymentDTO = {
  id: number;
  method: PaymentMethod;
  amountCents: number;
  occurredAt: Date;
  description: string | null;
};

export type OrderDetail = {
  id: number;
  status: OrderStatus;
  occurredAt: Date;
  completedAt: Date | null;
  customer: { id: number; name: string; phone: string | null };
  vehicle: OrderVehicleSummary | null;
  notes: string | null;
  items: OrderItemDTO[];
  payments: OrderPaymentDTO[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  paymentStatus: PaymentStatus | null;
};

export type ServiceForVehicle = ServiceDTO & { suggestedPriceCents: number };

/** Produto vendável no atendimento: ativo e com preço de venda (E9). */
export type ProductForSale = {
  id: number;
  name: string;
  unit: string;
  salePriceCents: number;
  stockQuantity: number;
};

export type DayCash = {
  /** "yyyy-mm-dd" (dia em America/Sao_Paulo) */
  date: string;
  entries: {
    id: number;
    orderId: number;
    customerName: string;
    method: PaymentMethod;
    amountCents: number;
    occurredAt: Date;
  }[];
  totalsByMethod: Record<PaymentMethod, number>;
  totalCents: number;
};

export const MSG = {
  invalidId: "Identificador inválido",
  invalidData: "Dados inválidos",
  orderNotFound: "Atendimento não encontrado",
  itemNotFound: "Item não encontrado",
  paymentNotFound: "Pagamento não encontrado",
  customerNotFound: "Cliente não encontrado",
  customerInactive: "Cliente inativo. Reative o cliente antes.",
  vehicleNotFound: "Veículo não encontrado",
  vehicleInactive: "Veículo inativo. Reative o veículo antes.",
  vehicleNotOwned: "O veículo não pertence a este cliente",
  vehicleRequired: "Informe o veículo para atendimentos com serviços",
  vehicleTypeMismatch: "Esse veículo é de outro tipo e há serviços que não são oferecidos para ele",
  serviceNotFound: "Serviço não encontrado",
  serviceInactive: "Este serviço está inativo",
  productNotFound: "Produto não encontrado",
  productInactive: "Este produto está inativo",
  productNotForSale: "Este produto não tem preço de venda (é só de uso interno)",
  notOpen: "Só é possível concluir um atendimento em andamento",
  canceled: "Este atendimento está cancelado e não pode ser alterado",
  needsItem: "Adicione ao menos um item antes de concluir",
  lastItemDone: "Um atendimento concluído precisa de ao menos um item. Cancele o atendimento.",
  vehicleOnlyOpen: "O veículo só pode ser trocado enquanto o atendimento está em andamento",
  nothingToUpdate: "Nada para alterar",
  discountTooHigh:
    "O desconto não pode ser maior que o subtotal (reduza o desconto antes de remover itens)",
  totalBelowPaid: "O total do atendimento não pode ficar menor que o valor já pago",
  paymentsAboveTotal: "A soma dos pagamentos não pode ser maior que o total do atendimento",
  paymentAboveBalance: "O valor é maior que o saldo em aberto do atendimento",
  alreadyPaid: "Este atendimento já está quitado",
  paymentNeedsDone: "Só é possível receber pagamento de um atendimento concluído",
  cancelWithPayments: "Não é possível cancelar um atendimento com pagamentos. Estorne-os antes.",
  alreadyCanceled: "Este atendimento já está cancelado",
  futureDate: "A data do pagamento não pode ser futura",
  deleteOnlyCanceled:
    "Só é possível excluir atendimentos cancelados. Cancele o atendimento antes de excluir.",
  deleteWithPayments:
    "Este atendimento tem lançamentos no caixa e não pode ser excluído. Estorne os pagamentos antes.",
  notAnOrderPayment: "Este lançamento não é um pagamento de atendimento",
} as const;

const VEHICLE_LABEL: Record<VehicleType, string> = { CAR: "carro", MOTORCYCLE: "moto" };

/** Erro de regra de negócio: aborta e desfaz a transação; vira ActionResult de falha. */
export class DomainError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "DomainError";
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Estoque insuficiente para a venda. `fieldErrors.stockProductId` leva o id do produto para a tela
 * oferecer o atalho "Acertar inventário".
 */
export function insufficientStock(
  p: { id: number; name: string; unit: string },
  available: number,
  needed: number,
): DomainError {
  return new DomainError(
    `Estoque insuficiente de “${p.name}”: disponível ${available} ${p.unit}, necessário ${needed}.`,
    { stockProductId: String(p.id) },
  );
}

export function fail(error: string, fieldErrors?: Record<string, string>) {
  return { ok: false as const, error, fieldErrors };
}

/** fieldErrors com caminho completo: "items.0.serviceId", "payments.1.amountCents". */
export function zodFail(issues: { path: PropertyKey[]; message: string }[], prefix = "") {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".");
    if (key && !(`${prefix}${key}` in fieldErrors)) fieldErrors[`${prefix}${key}`] = i.message;
  }
  return fail(issues[0]?.message ?? MSG.invalidData, fieldErrors);
}

// SQLite (dev/testes): o adapter abre a transação com BEGIN (adiada). Uma transação que LÊ antes de escrever
// falha na hora com SQLITE_BUSY (Prisma P1008 "SocketTimeout") se OUTRO PROCESSO gravar no arquivo entre a
// leitura e a escrita (nos e2e: os helpers SQL dos outros workers semeiam dados em paralelo; dentro do
// servidor as transações já são serializadas pelo adapter). Começar por uma escrita sem efeito toma o lock de
// escrita já no início e o driver ESPERA (busy timeout) em vez de falhar. Postgres (produção): não se aplica.
const SQLITE = !isPostgresUrl(process.env.DATABASE_URL ?? "");

export async function run<T>(db: Db, fn: (tx: Client) => Promise<T>): Promise<ActionResult<T>> {
  try {
    return {
      ok: true,
      data: await db.$transaction(async (tx) => {
        if (SQLITE) await tx.$executeRaw`DELETE FROM "LoginAttempt" WHERE 1 = 0`;
        return fn(tx);
      }),
    };
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, e.fieldErrors);
    throw e;
  }
}

export function paymentStatusOf(
  status: OrderStatus,
  totalCents: number,
  paidCents: number,
): PaymentStatus | null {
  if (status !== "DONE") return null;
  if (paidCents >= totalCents) return "PAID"; // inclui OS de total R$ 0,00 (nada a receber)
  return paidCents === 0 ? "UNPAID" : "PARTIAL";
}

// ---------- recalcOrder: única escrita de totalCents/paidCents ----------

export async function recalcOrder(
  tx: Client,
  orderId: number,
): Promise<{ subtotalCents: number; totalCents: number; paidCents: number }> {
  const order = await tx.serviceOrder.findUnique({
    where: { id: orderId },
    select: { discountCents: true },
  });
  if (!order) throw new DomainError(MSG.orderNotFound);
  const items = await tx.serviceOrderItem.aggregate({
    where: { orderId },
    _sum: { totalCents: true },
  });
  const paid = await tx.cashEntry.aggregate({
    where: { serviceOrderId: orderId, direction: "IN" },
    _sum: { amountCents: true },
  });
  const subtotalCents = items._sum.totalCents ?? 0;
  const paidCents = paid._sum.amountCents ?? 0;
  if (order.discountCents > subtotalCents) {
    throw new DomainError(MSG.discountTooHigh, { discountCents: MSG.discountTooHigh });
  }
  const totalCents = subtotalCents - order.discountCents;
  if (totalCents < paidCents) throw new DomainError(MSG.totalBelowPaid);
  await tx.serviceOrder.update({ where: { id: orderId }, data: { totalCents, paidCents } });
  return { subtotalCents, totalCents, paidCents };
}

// ---------- Leitura ----------

const vehicleSummarySelect = {
  id: true,
  type: true,
  plate: true,
  brand: true,
  model: true,
  color: true,
} as const;

export async function getOrderDetail(db: Client, id: unknown): Promise<OrderDetail | null> {
  const oid = idSchema.safeParse(id);
  if (!oid.success) return null;
  const o = await db.serviceOrder.findUnique({
    where: { id: oid.data },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      vehicle: { select: vehicleSummarySelect },
      items: {
        orderBy: { id: "asc" },
        include: { product: { select: { unit: true, stockQuantity: true } } },
      },
      payments: { where: { direction: "IN" }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!o) return null;
  return {
    id: o.id,
    status: o.status,
    occurredAt: o.occurredAt,
    completedAt: o.completedAt,
    customer: o.customer,
    vehicle: o.vehicle,
    notes: o.notes,
    items: o.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      serviceId: i.serviceId,
      productId: i.productId,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.totalCents,
      unit: i.product?.unit ?? null,
      stockQuantity: i.product?.stockQuantity ?? null,
    })),
    payments: o.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amountCents: p.amountCents,
      occurredAt: p.occurredAt,
      description: p.description,
    })),
    subtotalCents: o.totalCents + o.discountCents,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    paidCents: o.paidCents,
    balanceCents: o.totalCents - o.paidCents,
    paymentStatus: paymentStatusOf(o.status, o.totalCents, o.paidCents),
  };
}

async function detailOrThrow(tx: Client, id: number): Promise<OrderDetail> {
  const d = await getOrderDetail(tx, id);
  if (!d) throw new DomainError(MSG.orderNotFound);
  return d;
}

/** Intervalo [início, fim] (fim inclusivo) em America/Sao_Paulo; data inválida/ausente = hoje. */
function dayRange(date: string | undefined, dateTo: string | undefined, now: Date) {
  const safe = (s: string | undefined) => {
    if (!s) return undefined;
    try {
      return parseDateBR(s);
    } catch {
      return undefined;
    }
  };
  const a = safe(date) ?? startOfDayBR(now);
  const b = safe(dateTo) ?? a;
  const [from, to] = a <= b ? [a, b] : [b, a];
  return { from: startOfDayBR(from), to: endOfDayBR(to), first: startOfDayBR(a) };
}

function ymd(d: Date): string {
  // en-CA formata como yyyy-mm-dd
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Lista por dia (ou intervalo) de `occurredAt` e status opcional. Mais recentes primeiro. */
export async function listOrders(
  db: Client,
  input: unknown = {},
  now: Date = new Date(),
): Promise<OrderListItem[]> {
  const p = listOrdersSchema.safeParse(input);
  const f = p.success ? p.data : {};
  const { from, to } = dayRange(f.date, f.dateTo, now);
  const rows = await db.serviceOrder.findMany({
    where: {
      occurredAt: { gte: from, lte: to },
      ...(f.status ? { status: f.status } : {}),
      ...(f.customerId ? { customerId: f.customerId } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    include: {
      customer: { select: { id: true, name: true } },
      vehicle: { select: vehicleSummarySelect },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    status: o.status,
    occurredAt: o.occurredAt,
    customer: o.customer,
    vehicle: o.vehicle,
    totalCents: o.totalCents,
    paidCents: o.paidCents,
    balanceCents: o.totalCents - o.paidCents,
    paymentStatus: paymentStatusOf(o.status, o.totalCents, o.paidCents),
  }));
}

/** Caixa do dia: pagamentos de atendimento recebidos na data (America/Sao_Paulo). */
export async function getDayCash(
  db: Client,
  input: unknown = {},
  now: Date = new Date(),
): Promise<DayCash> {
  const p = dayCashSchema.safeParse(input);
  const { from, to, first } = dayRange(p.success ? p.data.date : undefined, undefined, now);
  const rows = await db.cashEntry.findMany({
    where: {
      direction: "IN",
      serviceOrderId: { not: null },
      occurredAt: { gte: from, lte: to },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: { serviceOrder: { select: { id: true, customer: { select: { name: true } } } } },
  });
  const totalsByMethod: Record<PaymentMethod, number> = {
    CASH: 0,
    PIX: 0,
    DEBIT_CARD: 0,
    CREDIT_CARD: 0,
  };
  let totalCents = 0;
  for (const r of rows) {
    totalsByMethod[r.method] += r.amountCents;
    totalCents += r.amountCents;
  }
  return {
    date: ymd(first),
    entries: rows.map((r) => ({
      id: r.id,
      orderId: r.serviceOrder!.id,
      customerName: r.serviceOrder!.customer.name,
      method: r.method,
      amountCents: r.amountCents,
      occurredAt: r.occurredAt,
    })),
    totalsByMethod,
    totalCents,
  };
}

/** Serviços ativos oferecidos para o tipo do veículo, com o preço sugerido. */
export async function listServicesForVehicleType(
  db: Db,
  input: { vehicleType: unknown; q?: string },
): Promise<ServiceForVehicle[]> {
  const t = vehicleTypeInputSchema.parse(input.vehicleType);
  const all = await searchServices(db, { q: input.q ?? "" });
  const out: ServiceForVehicle[] = [];
  for (const s of all) {
    const price = t === "CAR" ? s.carPriceCents : s.motorcyclePriceCents;
    if (price !== null) out.push({ ...s, suggestedPriceCents: price });
  }
  return out;
}

/** Produtos ativos com preço de venda, por nome, com o estoque atual (E9). */
export async function listProductsForSale(db: Client): Promise<ProductForSale[]> {
  const rows = await db.product.findMany({
    where: { active: true, salePriceCents: { not: null } },
    orderBy: [{ searchName: "asc" }, { id: "asc" }],
    select: { id: true, name: true, unit: true, salePriceCents: true, stockQuantity: true },
  });
  return rows.map((p) => ({ ...p, salePriceCents: p.salePriceCents! }));
}

// ---------- Escrita: helpers ----------

/**
 * Trava a OS até o fim da transação (D-45). Em PostgreSQL um UPDATE pega o lock da linha
 * (equivale a SELECT ... FOR UPDATE, mas portável): escritas concorrentes na mesma OS esperam,
 * e as leituras seguintes (READ COMMITTED) já veem o que a anterior gravou. Em SQLite a
 * transação já é serializada. DEVE ser a primeira instrução da transação de escrita.
 */
export async function lockOrder(tx: Client, id: number): Promise<void> {
  const locked = await tx.serviceOrder.updateMany({
    where: { id },
    data: { updatedAt: new Date() },
  });
  if (locked.count === 0) throw new DomainError(MSG.orderNotFound);
}

async function loadOrder(tx: Client, id: number) {
  await lockOrder(tx, id);
  const o = await tx.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerId: true,
      vehicleId: true,
      vehicle: { select: { type: true } },
    },
  });
  if (!o) throw new DomainError(MSG.orderNotFound);
  return o;
}

async function checkVehicle(tx: Client, vehicleId: number, customerId: number) {
  const v = await tx.vehicle.findUnique({
    where: { id: vehicleId },
    select: { customerId: true, active: true, type: true },
  });
  if (!v) throw new DomainError(MSG.vehicleNotFound, { vehicleId: MSG.vehicleNotFound });
  if (v.customerId !== customerId) {
    throw new DomainError(MSG.vehicleNotOwned, { vehicleId: MSG.vehicleNotOwned });
  }
  if (!v.active) throw new DomainError(MSG.vehicleInactive, { vehicleId: MSG.vehicleInactive });
  return v;
}

async function buildServiceItem(
  tx: Client,
  orderId: number,
  vehicleType: VehicleType,
  input: { serviceId: number; quantity: number; unitPriceCents?: number },
  prefix: string,
) {
  const key = (f: string) => `${prefix}${f}`;
  const s = await tx.service.findUnique({
    where: { id: input.serviceId },
    select: {
      id: true,
      name: true,
      active: true,
      carPriceCents: true,
      motorcyclePriceCents: true,
    },
  });
  if (!s) throw new DomainError(MSG.serviceNotFound, { [key("serviceId")]: MSG.serviceNotFound });
  if (!s.active) {
    throw new DomainError(MSG.serviceInactive, { [key("serviceId")]: MSG.serviceInactive });
  }
  const suggested = vehicleType === "CAR" ? s.carPriceCents : s.motorcyclePriceCents;
  if (suggested === null) {
    const m = `O serviço "${s.name}" não é oferecido para ${VEHICLE_LABEL[vehicleType]}`;
    throw new DomainError(m, { [key("serviceId")]: m });
  }
  const unitPriceCents = input.unitPriceCents ?? suggested;
  return {
    orderId,
    kind: "SERVICE" as const,
    serviceId: s.id,
    description: s.name,
    quantity: input.quantity,
    unitPriceCents,
    totalCents: input.quantity * unitPriceCents,
  };
}

async function buildProductItem(
  tx: Client,
  orderId: number,
  input: { productId: number; quantity: number; unitPriceCents?: number },
  prefix: string,
) {
  const key = `${prefix}productId`;
  const p = await tx.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true, active: true, salePriceCents: true },
  });
  if (!p) throw new DomainError(MSG.productNotFound, { [key]: MSG.productNotFound });
  if (!p.active) throw new DomainError(MSG.productInactive, { [key]: MSG.productInactive });
  if (p.salePriceCents === null) {
    throw new DomainError(MSG.productNotForSale, { [key]: MSG.productNotForSale });
  }
  const unitPriceCents = input.unitPriceCents ?? p.salePriceCents;
  return {
    orderId,
    kind: "PRODUCT" as const,
    productId: p.id,
    description: p.name,
    quantity: input.quantity,
    unitPriceCents,
    totalCents: input.quantity * unitPriceCents,
  };
}

// ---------- Estoque da venda (E9, D-15) ----------

/** Trava o produto e devolve nome/unidade (para mensagens) e o saldo pela soma das movimentações. */
async function lockedStock(tx: Client, productId: number) {
  await lockProduct(tx, productId);
  const p = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, name: true, unit: true },
  });
  return { p, available: await sumProductStock(tx, productId) };
}

function saleReason(orderId: number) {
  return `Venda OS nº ${orderId}`;
}

/** Conclusão: uma baixa SALE por item PRODUCT. Confere o saldo somando os itens do mesmo produto. */
async function createOrderSales(tx: Client, orderId: number, now: Date) {
  const items = await tx.serviceOrderItem.findMany({
    where: { orderId, kind: "PRODUCT" },
    select: { id: true, productId: true, quantity: true },
    orderBy: { id: "asc" },
  });
  const needed = new Map<number, number>();
  for (const it of items) needed.set(it.productId!, (needed.get(it.productId!) ?? 0) + it.quantity);
  const productIds = [...needed.keys()].sort((a, b) => a - b);
  for (const pid of productIds) {
    const { p, available } = await lockedStock(tx, pid);
    if (needed.get(pid)! > available) throw insufficientStock(p, available, needed.get(pid)!);
  }
  for (const it of items) {
    await tx.stockMovement.create({
      data: {
        productId: it.productId!,
        type: "SALE",
        quantity: -it.quantity,
        reason: saleReason(orderId),
        serviceOrderItemId: it.id,
        occurredAt: now,
      },
    });
  }
  for (const pid of productIds) await recomputeProductStock(tx, pid);
}

/**
 * Item PRODUCT de OS concluída: deixa a baixa SALE do item em `−quantity` (cria se não houver).
 * Só confere o saldo quando a baixa aumenta.
 */
async function syncItemSale(
  tx: Client,
  item: { id: number; orderId: number; productId: number; quantity: number },
  now: Date,
) {
  const { p, available } = await lockedStock(tx, item.productId);
  const current = await tx.stockMovement.findUnique({
    where: { serviceOrderItemId: item.id },
    select: { id: true, quantity: true },
  });
  const extra = item.quantity - (current ? -current.quantity : 0);
  if (extra > available) throw insufficientStock(p, available, extra);
  if (current) {
    await tx.stockMovement.update({
      where: { id: current.id },
      data: { quantity: -item.quantity },
    });
  } else {
    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        type: "SALE",
        quantity: -item.quantity,
        reason: saleReason(item.orderId),
        serviceOrderItemId: item.id,
        occurredAt: now,
      },
    });
  }
  await recomputeProductStock(tx, item.productId);
}

/** Exclui as baixas SALE (produto volta ao estoque): dos itens dados ou de todos os itens da OS. */
async function deleteSales(tx: Client, orderId: number, itemIds?: number[]) {
  const sales = await tx.stockMovement.findMany({
    where: {
      type: "SALE",
      serviceOrderItem: { orderId },
      ...(itemIds ? { serviceOrderItemId: { in: itemIds } } : {}),
    },
    select: { id: true, productId: true },
  });
  if (sales.length === 0) return;
  const productIds = [...new Set(sales.map((s) => s.productId))].sort((a, b) => a - b);
  for (const pid of productIds) await lockProduct(tx, pid);
  await tx.stockMovement.deleteMany({ where: { id: { in: sales.map((s) => s.id) } } });
  for (const pid of productIds) await recomputeProductStock(tx, pid);
}

// ---------- Escrita: atendimento ----------

export async function createOrder(
  db: Db,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<OrderDetail>> {
  const p = createOrderSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  // Veículo só é obrigatório com serviço; venda só de produtos dispensa (E9).
  if (d.items.length > 0 && d.vehicleId === null) {
    return fail(MSG.vehicleRequired, { vehicleId: MSG.vehicleRequired });
  }
  return run(db, async (tx) => {
    const c = await tx.customer.findUnique({
      where: { id: d.customerId },
      select: { active: true },
    });
    if (!c) throw new DomainError(MSG.customerNotFound, { customerId: MSG.customerNotFound });
    if (!c.active) {
      throw new DomainError(MSG.customerInactive, { customerId: MSG.customerInactive });
    }
    const vehicle = d.vehicleId === null ? null : await checkVehicle(tx, d.vehicleId, d.customerId);
    const order = await tx.serviceOrder.create({
      data: {
        customerId: d.customerId,
        vehicleId: d.vehicleId,
        occurredAt: d.occurredAt ?? now,
        discountCents: d.discountCents,
        notes: d.notes ?? null,
      },
      select: { id: true },
    });
    for (const [i, it] of d.items.entries()) {
      const data = await buildServiceItem(tx, order.id, vehicle!.type, it, `items.${i}.`);
      await tx.serviceOrderItem.create({ data });
    }
    for (const [i, it] of d.products.entries()) {
      const data = await buildProductItem(tx, order.id, it, `products.${i}.`);
      await tx.serviceOrderItem.create({ data });
    }
    await recalcOrder(tx, order.id);
    return detailOrThrow(tx, order.id);
  });
}

/** Edita veículo (só OPEN), desconto e observação. Campos ausentes não mudam. */
export async function updateOrder(
  db: Db,
  id: unknown,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  const oid = idSchema.safeParse(id);
  if (!oid.success) return fail(MSG.invalidId);
  const p = updateOrderSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  if (d.vehicleId === undefined && d.discountCents === undefined && d.notes === undefined) {
    return fail(MSG.nothingToUpdate);
  }
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data);
    if (o.status === "CANCELED") throw new DomainError(MSG.canceled);
    const data: Prisma.ServiceOrderUncheckedUpdateInput = {};
    if (d.discountCents !== undefined) data.discountCents = d.discountCents;
    if (d.notes !== undefined) data.notes = d.notes;
    if (d.vehicleId !== undefined && d.vehicleId !== o.vehicleId) {
      if (o.status !== "OPEN") {
        throw new DomainError(MSG.vehicleOnlyOpen, { vehicleId: MSG.vehicleOnlyOpen });
      }
      const serviceItems = await tx.serviceOrderItem.findMany({
        where: { orderId: o.id, kind: "SERVICE" },
        select: { service: { select: { carPriceCents: true, motorcyclePriceCents: true } } },
      });
      if (d.vehicleId === null) {
        if (serviceItems.length > 0) {
          throw new DomainError(MSG.vehicleRequired, { vehicleId: MSG.vehicleRequired });
        }
      } else {
        const v = await checkVehicle(tx, d.vehicleId, o.customerId);
        const offered = serviceItems.every((it) => {
          const price =
            v.type === "CAR" ? it.service?.carPriceCents : it.service?.motorcyclePriceCents;
          return price !== null && price !== undefined;
        });
        if (!offered) {
          throw new DomainError(MSG.vehicleTypeMismatch, { vehicleId: MSG.vehicleTypeMismatch });
        }
      }
      data.vehicleId = d.vehicleId;
    }
    await tx.serviceOrder.update({ where: { id: o.id }, data });
    await recalcOrder(tx, o.id);
    return detailOrThrow(tx, o.id);
  });
}

// ---------- Escrita: itens ----------

export async function addServiceItem(
  db: Db,
  orderId: unknown,
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  const oid = idSchema.safeParse(orderId);
  if (!oid.success) return fail(MSG.invalidId);
  const p = newItemSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data);
    if (o.status === "CANCELED") throw new DomainError(MSG.canceled);
    if (!o.vehicle) throw new DomainError(MSG.vehicleRequired, { vehicleId: MSG.vehicleRequired });
    const data = await buildServiceItem(tx, o.id, o.vehicle.type, p.data, "");
    await tx.serviceOrderItem.create({ data });
    await recalcOrder(tx, o.id);
    return detailOrThrow(tx, o.id);
  });
}

/**
 * Produto vendido (E9). Em OS em andamento não mexe no estoque; em OS concluída baixa na hora
 * (bloqueado se o estoque não der).
 */
export async function addProductItem(
  db: Db,
  orderId: unknown,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<OrderDetail>> {
  const oid = idSchema.safeParse(orderId);
  if (!oid.success) return fail(MSG.invalidId);
  const p = newProductItemSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data);
    if (o.status === "CANCELED") throw new DomainError(MSG.canceled);
    const data = await buildProductItem(tx, o.id, p.data, "");
    const it = await tx.serviceOrderItem.create({ data, select: { id: true } });
    if (o.status === "DONE") await syncItemSale(tx, { ...data, id: it.id }, now);
    await recalcOrder(tx, o.id);
    return detailOrThrow(tx, o.id);
  });
}

async function loadItem(tx: Client, itemId: number) {
  const itemSelect = {
    id: true,
    orderId: true,
    kind: true,
    productId: true,
    quantity: true,
    unitPriceCents: true,
  };
  const first = await tx.serviceOrderItem.findUnique({
    where: { id: itemId },
    select: { orderId: true },
  });
  if (!first) throw new DomainError(MSG.itemNotFound);
  const o = await loadOrder(tx, first.orderId); // trava a OS
  // Relê depois do lock: outra requisição pode ter alterado/removido o item enquanto esperava.
  const it = await tx.serviceOrderItem.findUnique({ where: { id: itemId }, select: itemSelect });
  if (!it) throw new DomainError(MSG.itemNotFound);
  if (o.status === "CANCELED") throw new DomainError(MSG.canceled);
  return { it, o };
}

/**
 * Altera quantidade e/ou preço (snapshot editável) de item de serviço ou produto. Serviço/produto
 * inativo continua editável. Produto em OS concluída: a baixa SALE acompanha a nova quantidade.
 */
export async function updateOrderItem(
  db: Db,
  itemId: unknown,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<OrderDetail>> {
  const iid = idSchema.safeParse(itemId);
  if (!iid.success) return fail(MSG.invalidId);
  const p = updateItemSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  if (p.data.quantity === undefined && p.data.unitPriceCents === undefined) {
    return fail(MSG.nothingToUpdate);
  }
  return run(db, async (tx) => {
    const { it, o } = await loadItem(tx, iid.data);
    const quantity = p.data.quantity ?? it.quantity;
    const unitPriceCents = p.data.unitPriceCents ?? it.unitPriceCents;
    await tx.serviceOrderItem.update({
      where: { id: it.id },
      data: { quantity, unitPriceCents, totalCents: quantity * unitPriceCents },
    });
    if (it.kind === "PRODUCT" && o.status === "DONE" && quantity !== it.quantity) {
      await syncItemSale(tx, { ...it, productId: it.productId!, quantity }, now);
    }
    await recalcOrder(tx, it.orderId);
    return detailOrThrow(tx, it.orderId);
  });
}

/** Remove item de serviço ou produto. Produto em OS concluída volta ao estoque (exclui a baixa SALE). */
export async function removeOrderItem(db: Db, itemId: unknown): Promise<ActionResult<OrderDetail>> {
  const iid = idSchema.safeParse(itemId);
  if (!iid.success) return fail(MSG.invalidId);
  return run(db, async (tx) => {
    const { it, o } = await loadItem(tx, iid.data);
    if (o.status === "DONE") {
      const count = await tx.serviceOrderItem.count({ where: { orderId: o.id } });
      if (count <= 1) throw new DomainError(MSG.lastItemDone);
    }
    if (it.kind === "PRODUCT") await deleteSales(tx, o.id, [it.id]);
    await tx.serviceOrderItem.delete({ where: { id: it.id } });
    await recalcOrder(tx, o.id);
    return detailOrThrow(tx, o.id);
  });
}

/** Nomes da E4 (só serviço), mantidos: hoje tratam qualquer item. */
export const updateServiceItem = updateOrderItem;
export const removeServiceItem = removeOrderItem;

// ---------- Escrita: conclusão, cancelamento, pagamentos ----------

/**
 * Conclui (OPEN -> DONE) e grava 0..N pagamentos na mesma transação.
 * Lista vazia = Fiado (nenhum CashEntry). Soma <= total; o restante fica em aberto (Parcial).
 * OS de total R$ 0,00 conclui normalmente (só com lista vazia) e fica "Pago".
 * O pagamento entra no caixa com data/hora `now`. Cada item de produto gera a baixa SALE (E9);
 * estoque insuficiente bloqueia a conclusão inteira (nada é gravado).
 */
export async function completeOrder(
  db: Db,
  orderId: unknown,
  payments: unknown = [],
  now: Date = new Date(),
): Promise<ActionResult<OrderDetail>> {
  const oid = idSchema.safeParse(orderId);
  if (!oid.success) return fail(MSG.invalidId);
  const p = paymentLinesSchema.safeParse(payments);
  if (!p.success) return zodFail(p.error.issues, "payments.");
  const lines = p.data;
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data);
    if (o.status === "CANCELED") throw new DomainError(MSG.canceled);
    if (o.status !== "OPEN") throw new DomainError(MSG.notOpen);
    if ((await tx.serviceOrderItem.count({ where: { orderId: o.id } })) === 0) {
      throw new DomainError(MSG.needsItem);
    }
    // Guarda de concorrência: só uma requisição consegue sair de OPEN.
    const moved = await tx.serviceOrder.updateMany({
      where: { id: o.id, status: "OPEN" },
      data: { status: "DONE", completedAt: now },
    });
    if (moved.count === 0) throw new DomainError(MSG.notOpen);
    const { totalCents } = await recalcOrder(tx, o.id);
    const sum = lines.reduce((acc, l) => acc + l.amountCents, 0);
    if (sum > totalCents) {
      throw new DomainError(MSG.paymentsAboveTotal, { payments: MSG.paymentsAboveTotal });
    }
    for (const l of lines) {
      await tx.cashEntry.create({
        data: {
          direction: "IN",
          amountCents: l.amountCents,
          method: l.method,
          serviceOrderId: o.id,
          occurredAt: now,
        },
      });
    }
    await createOrderSales(tx, o.id, now);
    await recalcOrder(tx, o.id);
    return detailOrThrow(tx, o.id);
  });
}

/**
 * OPEN: sempre (não há baixa). DONE: só sem pagamentos (estorne antes); devolve ao estoque tudo o
 * que a OS baixou (E9). CANCELED: rejeitado.
 */
export async function cancelOrder(db: Db, orderId: unknown): Promise<ActionResult<OrderDetail>> {
  const oid = idSchema.safeParse(orderId);
  if (!oid.success) return fail(MSG.invalidId);
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data);
    if (o.status === "CANCELED") throw new DomainError(MSG.alreadyCanceled);
    const moved = await tx.serviceOrder.updateMany({
      where: { id: o.id, status: o.status },
      data: { status: "CANCELED" },
    });
    if (moved.count === 0) throw new DomainError(MSG.alreadyCanceled);
    // Depois de mudar o status (evita corrida com um pagamento concorrente): sem pagamentos.
    if ((await tx.cashEntry.count({ where: { serviceOrderId: o.id } })) > 0) {
      throw new DomainError(MSG.cancelWithPayments);
    }
    if (o.status === "DONE") await deleteSales(tx, o.id);
    return detailOrThrow(tx, o.id);
  });
}

/** Recebimento posterior (só OS concluída, valor <= saldo). */
export async function registerPayment(
  db: Db,
  orderId: unknown,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<OrderDetail>> {
  const oid = idSchema.safeParse(orderId);
  if (!oid.success) return fail(MSG.invalidId);
  const p = addPaymentSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const occurredAt = p.data.occurredAt ?? now;
  if (occurredAt.getTime() > now.getTime()) {
    return fail(MSG.futureDate, { occurredAt: MSG.futureDate });
  }
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data);
    if (o.status === "CANCELED") throw new DomainError(MSG.canceled);
    if (o.status !== "DONE") throw new DomainError(MSG.paymentNeedsDone);
    const { totalCents, paidCents } = await recalcOrder(tx, o.id);
    const balance = totalCents - paidCents;
    if (balance <= 0) throw new DomainError(MSG.alreadyPaid);
    if (p.data.amountCents > balance) {
      throw new DomainError(MSG.paymentAboveBalance, { amountCents: MSG.paymentAboveBalance });
    }
    await addPaymentEntry(tx, o.id, p.data.amountCents, p.data.method, occurredAt);
    return detailOrThrow(tx, o.id);
  });
}

/**
 * Grava o pagamento (CashEntry IN da OS) e recalcula. Única porta de entrada de recebimento
 * posterior: usada por `registerPayment` e por `receiveFromCustomer` (E6). A OS já deve estar
 * travada e validada (DONE, valor <= saldo) pelo chamador.
 */
export async function addPaymentEntry(
  tx: Client,
  orderId: number,
  amountCents: number,
  method: PaymentMethod,
  occurredAt: Date,
): Promise<void> {
  await tx.cashEntry.create({
    data: { direction: "IN", amountCents, method, serviceOrderId: orderId, occurredAt },
  });
  await recalcOrder(tx, orderId);
}

/** Estorno: exclui o pagamento (D-17) e recalcula. Não mexe em estoque. */
export async function deletePayment(
  db: Db,
  paymentId: unknown,
): Promise<ActionResult<OrderDetail>> {
  const pid = idSchema.safeParse(paymentId);
  if (!pid.success) return fail(MSG.invalidId);
  return run(db, async (tx) => {
    const entrySelect = { id: true, direction: true, serviceOrderId: true };
    const first = await tx.cashEntry.findUnique({ where: { id: pid.data }, select: entrySelect });
    if (!first) throw new DomainError(MSG.paymentNotFound);
    if (first.direction === "IN" && first.serviceOrderId !== null) {
      await lockOrder(tx, first.serviceOrderId);
    }
    // Relê depois do lock: um estorno concorrente do mesmo pagamento já pode tê-lo removido.
    const e = await tx.cashEntry.findUnique({ where: { id: pid.data }, select: entrySelect });
    if (!e) throw new DomainError(MSG.paymentNotFound);
    if (e.direction !== "IN" || e.serviceOrderId === null) {
      throw new DomainError(MSG.notAnOrderPayment);
    }
    await tx.cashEntry.delete({ where: { id: e.id } });
    await recalcOrder(tx, e.serviceOrderId);
    return detailOrThrow(tx, e.serviceOrderId);
  });
}

/**
 * Exclusão definitiva (D-47): só atendimento CANCELADO e sem lançamentos no caixa; remove os itens
 * junto. Não mexe em estoque: itens de serviço nunca têm baixa e a OS cancelada não tem baixa de
 * produto (OPEN nunca baixou; DONE->CANCELED reverte as baixas, E8).
 */
export async function deleteOrder(
  db: Db,
  orderId: unknown,
): Promise<ActionResult<{ id: number; customerId: number }>> {
  const oid = idSchema.safeParse(orderId);
  if (!oid.success) return fail(MSG.invalidId);
  return run(db, async (tx) => {
    const o = await loadOrder(tx, oid.data); // trava a OS
    if (o.status !== "CANCELED") throw new DomainError(MSG.deleteOnlyCanceled);
    if ((await tx.cashEntry.count({ where: { serviceOrderId: o.id } })) > 0) {
      throw new DomainError(MSG.deleteWithPayments);
    }
    await tx.serviceOrderItem.deleteMany({ where: { orderId: o.id } });
    await tx.serviceOrder.delete({ where: { id: o.id } });
    return { id: o.id, customerId: o.customerId };
  });
}
