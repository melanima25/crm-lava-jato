// Regras de negócio do estoque (E8): movimentações manuais (entrada, baixa, acerto), cache do saldo e consultas.
// Sem cookies/Next: recebe o cliente Prisma. Decisões: D-55 a D-58 (docs/decisoes.md).
//
//  - `Product.stockQuantity` = Σ StockMovement.quantity SEMPRE. O cache é escrito SÓ por
//    `recomputeProductStock(tx, productId)`, na mesma transação de qualquer criação/edição/exclusão
//    de movimentação (a E9 usa a mesma função para as baixas SALE).
//  - Toda escrita começa com `lockProduct` (UPDATE da linha do produto: em Postgres toma o lock da linha,
//    como `lockOrder`), então baixas simultâneas se serializam e nenhuma fura o saldo.
//  - Estoque nunca negativo: checagem com mensagem amigável antes de gravar + invariante em
//    `recomputeProductStock` (desfaz a transação).
//  - SALE é intocável por aqui: só o atendimento (E9) cria/altera/exclui.
//  - Entrada com "lançar compra no caixa": CashEntry OUT em "Compra de produtos" na MESMA transação.
import type { PrismaClient } from "@/generated/prisma/client";
import { foldText } from "@/lib/text";
import { ensureSystemCashCategories } from "@/server/cash/categories";
import {
  DomainError,
  fail,
  run,
  zodFail,
  type ActionResult,
  type Client,
  type PaymentMethod,
} from "@/server/orders/domain";
import { idSchema } from "@/server/orders/schemas";
import {
  adjustStockSchema,
  historySchema,
  listStockSchema,
  stockInSchema,
  stockOutSchema,
  updateMovementSchema,
} from "./schemas";

type Db = PrismaClient;
export type StockMovementType = "IN" | "OUT" | "ADJUSTMENT" | "SALE";

export const STOCK_MSG = {
  invalidId: "Identificador inválido",
  productNotFound: "Produto não encontrado",
  movementNotFound: "Movimentação não encontrada",
  productInactive: "Este produto está inativo. Reative-o para registrar entradas e baixas.",
  futureDate: "A data da movimentação não pode ser futura",
  saleLocked:
    "Esta movimentação é uma venda de atendimento. Altere ou remova o item pelo atendimento.",
  noDelta: "A contagem é igual ao estoque atual. Nada a ajustar.",
  quantityMustBePositive: "A quantidade deve ser maior que zero",
  purchaseOnlyIn: "Só entradas podem ter compra lançada no caixa",
  invariantNegative: "O estoque não pode ficar negativo",
} as const;

const insufficient = (name: string, available: number, unit: string) =>
  `Estoque insuficiente de “${name}”: disponível ${available} ${unit}.`;
const wouldGoNegative = (name: string, available: number, unit: string) =>
  `Não é possível: o estoque de “${name}” ficaria negativo (saldo atual ${available} ${unit}).`;

// ---------- Núcleo: lock e cache ----------

/**
 * Lock de linha do produto. DEVE ser a primeira instrução da transação de escrita de estoque.
 * `UPDATE` da linha (updatedAt): em Postgres toma o lock até o fim da transação (≈ SELECT ... FOR UPDATE,
 * sem SQL cru); em SQLite a transação já é serializada. Mesmo padrão de `lockOrder` (D-45).
 */
export async function lockProduct(tx: Client, productId: number): Promise<void> {
  const r = await tx.product.updateMany({
    where: { id: productId },
    data: { updatedAt: new Date() },
  });
  if (r.count === 0) throw new DomainError(STOCK_MSG.productNotFound);
}

/** Σ das movimentações (fonte da verdade). */
export async function sumProductStock(tx: Client, productId: number): Promise<number> {
  const a = await tx.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } });
  return a._sum.quantity ?? 0;
}

/**
 * ÚNICA escrita de `Product.stockQuantity` (análoga a `recalcOrder`). Recalcula a soma das movimentações,
 * grava o cache e valida o invariante (saldo >= 0; senão lança e desfaz a transação). Retorna o saldo.
 */
export async function recomputeProductStock(tx: Client, productId: number): Promise<number> {
  const total = await sumProductStock(tx, productId);
  if (total < 0) throw new DomainError(STOCK_MSG.invariantNegative);
  await tx.product.update({ where: { id: productId }, data: { stockQuantity: total } });
  return total;
}

// ---------- DTOs ----------

export type StockProductDTO = {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  salePriceCents: number | null;
  stockQuantity: number;
  minStockQuantity: number | null;
  /** estoque <= mínimo (só quando há mínimo). */
  low: boolean;
  active: boolean;
};

export type StockMovementDTO = {
  id: number;
  productId: number;
  type: StockMovementType;
  /** Delta com sinal (entrada > 0; baixa/venda < 0; acerto != 0). */
  quantity: number;
  reason: string | null;
  occurredAt: Date;
  createdAt: Date;
  /** Saldo do produto logo após esta movimentação (ordem occurredAt, id). */
  balanceAfter: number;
  /** Compra lançada no caixa (entrada). */
  cashEntry: { id: number; amountCents: number; method: PaymentMethod } | null;
  /** SALE: atendimento de origem ("Venda — OS nº X"). */
  orderId: number | null;
  /** false = SALE (só pelo atendimento). */
  editable: boolean;
  lockedReason: string | null;
};

export type StockMovementResult = {
  movement: StockMovementDTO;
  /** Saldo atual do produto após a operação. */
  stockQuantity: number;
  low: boolean;
};

export type StockHistory = {
  product: StockProductDTO;
  movements: StockMovementDTO[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
};

export type LowStockSummary = {
  count: number;
  items: {
    id: number;
    name: string;
    unit: string;
    stockQuantity: number;
    minStockQuantity: number;
  }[];
};

const productSelect = {
  id: true,
  name: true,
  description: true,
  unit: true,
  salePriceCents: true,
  stockQuantity: true,
  minStockQuantity: true,
  active: true,
} as const;

function toProductDTO(p: {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  salePriceCents: number | null;
  stockQuantity: number;
  minStockQuantity: number | null;
  active: boolean;
}): StockProductDTO {
  return {
    ...p,
    low: p.minStockQuantity !== null && p.stockQuantity <= p.minStockQuantity,
  };
}

const movementInclude = {
  cashEntry: { select: { id: true, amountCents: true, method: true } },
  serviceOrderItem: { select: { orderId: true } },
} as const;

type MovementRow = {
  id: number;
  productId: number;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  occurredAt: Date;
  createdAt: Date;
  cashEntry: { id: number; amountCents: number; method: PaymentMethod } | null;
  serviceOrderItem: { orderId: number } | null;
};

function rowToDTO(m: MovementRow, balanceAfter: number): StockMovementDTO {
  const sale = m.type === "SALE";
  return {
    id: m.id,
    productId: m.productId,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    occurredAt: m.occurredAt,
    createdAt: m.createdAt,
    balanceAfter,
    cashEntry: m.cashEntry,
    orderId: m.serviceOrderItem?.orderId ?? null,
    editable: !sale,
    lockedReason: sale ? STOCK_MSG.saleLocked : null,
  };
}

async function movementDTO(tx: Client, id: number): Promise<StockMovementDTO> {
  const m = await tx.stockMovement.findUnique({ where: { id }, include: movementInclude });
  if (!m) throw new DomainError(STOCK_MSG.movementNotFound);
  // Saldo após a movimentação: Σ das anteriores na ordem (occurredAt, id) + ela mesma.
  const earlier = await tx.stockMovement.aggregate({
    where: {
      productId: m.productId,
      OR: [{ occurredAt: { lt: m.occurredAt } }, { occurredAt: m.occurredAt, id: { lt: m.id } }],
    },
    _sum: { quantity: true },
  });
  return rowToDTO(m, (earlier._sum.quantity ?? 0) + m.quantity);
}

async function result(
  tx: Client,
  movementId: number,
  productId: number,
): Promise<StockMovementResult> {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: productSelect });
  return {
    movement: await movementDTO(tx, movementId),
    stockQuantity: p.stockQuantity,
    low: toProductDTO(p).low,
  };
}

// ---------- Helpers de escrita ----------

function checkNotFuture(occurredAt: Date | undefined, now: Date) {
  if (occurredAt && occurredAt.getTime() > now.getTime()) {
    return fail(STOCK_MSG.futureDate, { occurredAt: STOCK_MSG.futureDate });
  }
  return null;
}

/** Trava o produto e carrega nome/unidade/ativo para as mensagens. */
async function loadLockedProduct(tx: Client, productId: number) {
  await lockProduct(tx, productId);
  const p = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, unit: true, active: true },
  });
  if (!p) throw new DomainError(STOCK_MSG.productNotFound);
  return p;
}

function requireActive(p: { active: boolean }) {
  if (!p.active) {
    throw new DomainError(STOCK_MSG.productInactive, { productId: STOCK_MSG.productInactive });
  }
}

function purchaseDescription(name: string, quantity: number, unit: string) {
  return `Compra de estoque: ${name} (${quantity} ${unit})`.slice(0, 200);
}

/** Id da categoria de sistema "Compra de produtos" (OUT), garantida antes da transação. */
async function purchaseCategoryId(tx: Client): Promise<number> {
  const c = await tx.cashCategory.findUnique({
    where: { name_direction: { name: "Compra de produtos", direction: "OUT" } },
    select: { id: true },
  });
  if (!c) throw new DomainError("Categoria “Compra de produtos” não encontrada");
  return c.id;
}

// ---------- Ações ----------

/** Entrada (compra). Com `purchase`, lança a despesa no caixa na mesma transação. */
export async function registerStockIn(
  db: Db,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<StockMovementResult>> {
  const p = stockInSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  const future = checkNotFuture(d.occurredAt, now);
  if (future) return future;
  const occurredAt = d.occurredAt ?? now;
  if (d.purchase) await ensureSystemCashCategories(db);

  return run(db, async (tx) => {
    const prod = await loadLockedProduct(tx, d.productId);
    requireActive(prod);
    let cashEntryId: number | null = null;
    if (d.purchase) {
      const e = await tx.cashEntry.create({
        data: {
          direction: "OUT",
          amountCents: d.purchase.amountCents,
          method: d.purchase.method,
          categoryId: await purchaseCategoryId(tx),
          description: purchaseDescription(prod.name, d.quantity, prod.unit),
          occurredAt,
        },
        select: { id: true },
      });
      cashEntryId = e.id;
    }
    const m = await tx.stockMovement.create({
      data: {
        productId: d.productId,
        type: "IN",
        quantity: d.quantity,
        reason: d.reason,
        cashEntryId,
        occurredAt,
      },
      select: { id: true },
    });
    await recomputeProductStock(tx, d.productId);
    return result(tx, m.id, d.productId);
  });
}

/** Baixa manual (uso, perda). Rejeita acima do disponível. */
export async function registerStockOut(
  db: Db,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<StockMovementResult>> {
  const p = stockOutSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  const future = checkNotFuture(d.occurredAt, now);
  if (future) return future;

  return run(db, async (tx) => {
    const prod = await loadLockedProduct(tx, d.productId);
    requireActive(prod);
    const available = await sumProductStock(tx, d.productId);
    if (d.quantity > available) {
      const msg = insufficient(prod.name, available, prod.unit);
      throw new DomainError(msg, { quantity: msg });
    }
    const m = await tx.stockMovement.create({
      data: {
        productId: d.productId,
        type: "OUT",
        quantity: -d.quantity,
        reason: d.reason,
        occurredAt: d.occurredAt ?? now,
      },
      select: { id: true },
    });
    await recomputeProductStock(tx, d.productId);
    return result(tx, m.id, d.productId);
  });
}

/** Acerto de inventário: recebe a quantidade CONTADA e grava o delta (contada − atual). */
export async function adjustStock(
  db: Db,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<StockMovementResult>> {
  const p = adjustStockSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  const future = checkNotFuture(d.occurredAt, now);
  if (future) return future;

  return run(db, async (tx) => {
    const prod = await loadLockedProduct(tx, d.productId); // acerto é permitido em produto inativo
    const current = await sumProductStock(tx, d.productId);
    const delta = d.countedQuantity - current;
    if (delta === 0) {
      const msg = `${STOCK_MSG.noDelta} (${current} ${prod.unit})`;
      throw new DomainError(msg, { countedQuantity: msg });
    }
    const m = await tx.stockMovement.create({
      data: {
        productId: d.productId,
        type: "ADJUSTMENT",
        quantity: delta,
        reason: d.reason,
        occurredAt: d.occurredAt ?? now,
      },
      select: { id: true },
    });
    await recomputeProductStock(tx, d.productId);
    return result(tx, m.id, d.productId);
  });
}

/** Lê a movimentação, trava o produto e relê (a movimentação pode ter sido excluída em paralelo). */
async function loadLockedMovement(tx: Client, id: number) {
  const first = await tx.stockMovement.findUnique({
    where: { id },
    select: { productId: true, type: true },
  });
  if (!first) throw new DomainError(STOCK_MSG.movementNotFound);
  if (first.type === "SALE") throw new DomainError(STOCK_MSG.saleLocked);
  const prod = await loadLockedProduct(tx, first.productId);
  const m = await tx.stockMovement.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      type: true,
      quantity: true,
      occurredAt: true,
      cashEntryId: true,
    },
  });
  if (!m) throw new DomainError(STOCK_MSG.movementNotFound);
  if (m.type === "SALE") throw new DomainError(STOCK_MSG.saleLocked);
  return { m, prod };
}

/**
 * Edita uma movimentação manual (IN/OUT/ADJUSTMENT). Edição que deixaria o estoque negativo é recusada.
 * Entrada com despesa ligada: a despesa acompanha data/descrição; `purchase` altera/cria/remove a despesa.
 */
export async function updateStockMovement(
  db: Db,
  id: unknown,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<StockMovementResult>> {
  const mid = idSchema.safeParse(id);
  if (!mid.success) return fail(STOCK_MSG.invalidId);
  const p = updateMovementSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  const future = checkNotFuture(d.occurredAt, now);
  if (future) return future;
  if (d.purchase) await ensureSystemCashCategories(db);

  return run(db, async (tx) => {
    const { m, prod } = await loadLockedMovement(tx, mid.data);
    if (m.type !== "ADJUSTMENT" && d.quantity < 0) {
      throw new DomainError(STOCK_MSG.quantityMustBePositive, {
        quantity: STOCK_MSG.quantityMustBePositive,
      });
    }
    if (m.type !== "IN" && d.purchase !== undefined) {
      throw new DomainError(STOCK_MSG.purchaseOnlyIn, { purchase: STOCK_MSG.purchaseOnlyIn });
    }
    const newQuantity = m.type === "OUT" ? -d.quantity : d.quantity;
    const available = await sumProductStock(tx, m.productId);
    if (available - m.quantity + newQuantity < 0) {
      const msg = wouldGoNegative(prod.name, available, prod.unit);
      throw new DomainError(msg, { quantity: msg });
    }
    const occurredAt = d.occurredAt ?? m.occurredAt;
    const data: {
      quantity: number;
      occurredAt: Date;
      reason?: string | null;
      cashEntryId?: number | null;
    } = { quantity: newQuantity, occurredAt };
    if (d.reason !== undefined) data.reason = d.reason;

    if (m.type === "IN") {
      const description = purchaseDescription(prod.name, newQuantity, prod.unit);
      if (d.purchase === null) {
        data.cashEntryId = null; // desliga antes de apagar a despesa (FK Restrict)
      } else if (d.purchase) {
        if (m.cashEntryId !== null) {
          await tx.cashEntry.update({
            where: { id: m.cashEntryId },
            data: {
              amountCents: d.purchase.amountCents,
              method: d.purchase.method,
              occurredAt,
              description,
            },
          });
        } else {
          const e = await tx.cashEntry.create({
            data: {
              direction: "OUT",
              amountCents: d.purchase.amountCents,
              method: d.purchase.method,
              categoryId: await purchaseCategoryId(tx),
              description,
              occurredAt,
            },
            select: { id: true },
          });
          data.cashEntryId = e.id;
        }
      } else if (m.cashEntryId !== null) {
        await tx.cashEntry.update({
          where: { id: m.cashEntryId },
          data: { occurredAt, description },
        });
      }
    }

    await tx.stockMovement.update({ where: { id: m.id }, data });
    if (m.type === "IN" && d.purchase === null && m.cashEntryId !== null) {
      await tx.cashEntry.delete({ where: { id: m.cashEntryId } });
    }
    await recomputeProductStock(tx, m.productId);
    return result(tx, m.id, m.productId);
  });
}

export type DeleteMovementResult = {
  id: number;
  productId: number;
  stockQuantity: number;
  /** Despesa de compra excluída junto, se havia. */
  removedCashEntryId: number | null;
};

/**
 * Exclui uma movimentação manual. Se a entrada tinha compra lançada no caixa, a DESPESA VINCULADA É
 * EXCLUÍDA JUNTO (mesma transação): a compra deixou de existir, então o caixa não pode continuar com ela.
 * Recusada se o estoque ficaria negativo.
 */
export async function deleteStockMovement(
  db: Db,
  id: unknown,
): Promise<ActionResult<DeleteMovementResult>> {
  const mid = idSchema.safeParse(id);
  if (!mid.success) return fail(STOCK_MSG.invalidId);
  return run(db, async (tx) => {
    const { m, prod } = await loadLockedMovement(tx, mid.data);
    const available = await sumProductStock(tx, m.productId);
    if (available - m.quantity < 0) {
      throw new DomainError(wouldGoNegative(prod.name, available, prod.unit));
    }
    await tx.stockMovement.delete({ where: { id: m.id } });
    if (m.cashEntryId !== null) await tx.cashEntry.delete({ where: { id: m.cashEntryId } });
    const stockQuantity = await recomputeProductStock(tx, m.productId);
    return { id: m.id, productId: m.productId, stockQuantity, removedCashEntryId: m.cashEntryId };
  });
}

// ---------- Consultas ----------

/** Texto de busca sem acento/caixa e sem curingas de LIKE. */
function searchText(q: string): string {
  return foldText(q).replace(/[%_]/g, "").trim();
}

/** Lista de estoque: produtos com saldo, mínimo e flag `low`. Padrão só ativos; ordenada por nome. */
export async function searchStock(
  db: Db | Client,
  input: unknown = {},
): Promise<StockProductDTO[]> {
  const { q, includeInactive, lowOnly } = listStockSchema.parse(input);
  const text = searchText(q);
  if (q.trim() && !text) return [];
  const rows = await db.product.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(text ? { searchName: { contains: text } } : {}),
    },
    orderBy: [{ searchName: "asc" }, { id: "asc" }],
    select: productSelect,
  });
  const items = rows.map(toProductDTO);
  return lowOnly ? items.filter((i) => i.low) : items;
}

/** Produtos ativos com estoque <= mínimo (mais críticos primeiro). Alimenta o card do Início. */
export async function getLowStockSummary(db: Db | Client): Promise<LowStockSummary> {
  const rows = await db.product.findMany({
    where: { active: true, minStockQuantity: { not: null } },
    orderBy: [{ searchName: "asc" }],
    select: { id: true, name: true, unit: true, stockQuantity: true, minStockQuantity: true },
  });
  const items = rows
    .filter((r) => r.minStockQuantity !== null && r.stockQuantity <= r.minStockQuantity)
    .map((r) => ({ ...r, minStockQuantity: r.minStockQuantity as number }))
    .sort((a, b) => a.stockQuantity - b.stockQuantity);
  return { count: items.length, items };
}

/** Produto + histórico (mais recente primeiro, paginado) com saldo após cada movimentação. */
export async function getProductStockHistory(
  db: Db | Client,
  productId: unknown,
  paging: unknown = {},
): Promise<StockHistory | null> {
  const pid = idSchema.safeParse(productId);
  if (!pid.success) return null;
  const product = await db.product.findUnique({ where: { id: pid.data }, select: productSelect });
  if (!product) return null;
  const { page, limit } = historySchema.parse(paging ?? {});

  // Saldo acumulado em ordem cronológica (occurredAt, id); leve: só id e quantidade.
  const all = await db.stockMovement.findMany({
    where: { productId: pid.data },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { id: true, quantity: true },
  });
  const balanceById = new Map<number, number>();
  let running = 0;
  for (const m of all) {
    running += m.quantity;
    balanceById.set(m.id, running);
  }

  const rows = await db.stockMovement.findMany({
    where: { productId: pid.data },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
    include: movementInclude,
  });
  return {
    product: toProductDTO(product),
    movements: rows.map((r) => rowToDTO(r, balanceById.get(r.id) ?? 0)),
    total: all.length,
    page,
    limit,
    pageCount: Math.max(1, Math.ceil(all.length / limit)),
  };
}
