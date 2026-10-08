// Regras de negócio do caixa (E7): lançamentos manuais, categorias, resumo e extrato por período.
// Sem cookies/Next: recebe o cliente Prisma. Dinheiro em centavos.
//
//  - Lançamento manual = CashEntry sem serviceOrderId (com categoryId). Pagamento de OS (serviceOrderId)
//    nunca é editado/excluído aqui: `canEditCashEntry` (ponto de extensão; lançamentos ligados a StockMovement também são recusados).
//  - Saldo acumulado = Σ IN − Σ OUT até o fim do período; resultado = mesma conta dentro do período.
//  - Limites de dia/semana/mês em America/Sao_Paulo (period.ts), consultas com gte/lte.
//  - Fiado não pago nunca aparece: só CashEntry conta.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { foldText } from "@/lib/text";
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
  ensureDefaultCashCategories,
  ensureSystemCashCategories,
  SYSTEM_CASH_CATEGORIES,
  systemCategoryKey,
  type SystemCategoryKey,
} from "./categories";
import { resolvePeriod, type ResolvedPeriod } from "./period";
import {
  cashEntryInputSchema,
  createCategorySchema,
  listEntriesSchema,
  periodInputSchema,
  updateCategorySchema,
} from "./schemas";

type Db = PrismaClient;
export type CashDirection = "IN" | "OUT";

export const CASH_MSG = {
  invalidId: "Identificador inválido",
  entryNotFound: "Lançamento não encontrado",
  categoryNotFound: "Categoria não encontrada",
  categoryInactive: "Esta categoria está inativa. Reative-a ou escolha outra.",
  categoryDirection: "A categoria precisa ser do mesmo tipo do lançamento (entrada/saída)",
  futureDate: "A data do lançamento não pode ser futura",
  orderPayment: "Este lançamento é um pagamento de atendimento. Edite ou estorne pelo atendimento.",
  stockLinked:
    "Este lançamento foi gerado por uma compra de estoque. Altere pela movimentação do produto.",
  orphanEntry: "Este lançamento não tem categoria e não pode ser alterado aqui",
  nothingToUpdate: "Nada para alterar",
  categoryDuplicate: "Já existe uma categoria com esse nome para este tipo",
  systemRename: "Categoria do sistema não pode ser renomeada",
  systemDirection: "Categoria do sistema não pode mudar de tipo",
  systemDelete: "Categoria do sistema não pode ser excluída",
  systemInactivate: "Esta categoria é usada pelo sistema e não pode ser inativada",
  usedDirection: "Categoria já usada em lançamentos não pode mudar de tipo",
  usedDelete: "Categoria com lançamentos não pode ser excluída. Inative-a.",
} as const;

// ---------- Ponto de extensão: quem pode ser editado/excluído nesta tela ----------

export type EditableCheckInput = {
  serviceOrderId: number | null;
  categoryId: number | null;
  /** E8: id da movimentação de estoque que gerou este lançamento (compra); presente = só se altera pelo estoque. */
  stockMovementId?: number | null;
};

export function canEditCashEntry(
  entry: EditableCheckInput,
): { ok: true } | { ok: false; error: string } {
  if (entry.serviceOrderId !== null) return { ok: false, error: CASH_MSG.orderPayment };
  if (entry.stockMovementId != null) return { ok: false, error: CASH_MSG.stockLinked };
  if (entry.categoryId === null) return { ok: false, error: CASH_MSG.orphanEntry };
  return { ok: true };
}

// ---------- DTOs ----------

export type CashEntryDTO = {
  id: number;
  direction: CashDirection;
  amountCents: number;
  method: PaymentMethod;
  occurredAt: Date;
  /** Descrição digitada (lançamento manual) ou null. */
  description: string | null;
  /** Título derivado: "Atendimento nº X" (pagamento de OS) ou o nome da categoria. */
  title: string;
  kind: "ORDER_PAYMENT" | "MANUAL";
  orderId: number | null;
  customerName: string | null;
  category: { id: number; name: string; active: boolean } | null;
  /** false = só se altera pelo atendimento (ou pelo estoque, E8). */
  editable: boolean;
  lockedReason: string | null;
};

type EntryRow = Prisma.CashEntryGetPayload<{
  include: {
    category: { select: { id: true; name: true; active: true } };
    serviceOrder: { select: { id: true; customer: { select: { name: true } } } };
    stockMovements: { select: { id: true }; take: 1 };
  };
}>;

const entryInclude = {
  category: { select: { id: true, name: true, active: true } },
  serviceOrder: { select: { id: true, customer: { select: { name: true } } } },
  stockMovements: { select: { id: true }, take: 1 },
} as const;

function toEntryDTO(r: EntryRow): CashEntryDTO {
  const check = canEditCashEntry({
    serviceOrderId: r.serviceOrderId,
    categoryId: r.categoryId,
    stockMovementId: r.stockMovements[0]?.id ?? null,
  });
  return {
    id: r.id,
    direction: r.direction,
    amountCents: r.amountCents,
    method: r.method,
    occurredAt: r.occurredAt,
    description: r.description,
    title: r.serviceOrder
      ? `Atendimento nº ${r.serviceOrder.id}`
      : (r.category?.name ?? "Sem categoria"),
    kind: r.serviceOrder ? "ORDER_PAYMENT" : "MANUAL",
    orderId: r.serviceOrder?.id ?? null,
    customerName: r.serviceOrder?.customer.name ?? null,
    category: r.category,
    editable: check.ok,
    lockedReason: check.ok ? null : check.error,
  };
}

async function entryDTOOrThrow(tx: Client, id: number): Promise<CashEntryDTO> {
  const r = await tx.cashEntry.findUnique({ where: { id }, include: entryInclude });
  if (!r) throw new DomainError(CASH_MSG.entryNotFound);
  return toEntryDTO(r);
}

// ---------- Lançamentos manuais ----------

/** Categoria precisa existir, ser da direção do lançamento e estar ativa (exceto a atual, ao editar). */
async function checkCategory(
  tx: Client,
  categoryId: number,
  direction: CashDirection,
  currentCategoryId: number | null,
) {
  const c = await tx.cashCategory.findUnique({
    where: { id: categoryId },
    select: { direction: true, active: true },
  });
  const f = (m: string) => new DomainError(m, { categoryId: m });
  if (!c) throw f(CASH_MSG.categoryNotFound);
  if (c.direction !== direction) throw f(CASH_MSG.categoryDirection);
  if (!c.active && categoryId !== currentCategoryId) throw f(CASH_MSG.categoryInactive);
}

export async function createCashEntry(
  db: Db,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<CashEntryDTO>> {
  const p = cashEntryInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  const occurredAt = d.occurredAt ?? now;
  if (occurredAt.getTime() > now.getTime()) {
    return fail(CASH_MSG.futureDate, { occurredAt: CASH_MSG.futureDate });
  }
  return run(db, async (tx) => {
    await checkCategory(tx, d.categoryId, d.direction, null);
    const e = await tx.cashEntry.create({
      data: {
        direction: d.direction,
        amountCents: d.amountCents,
        method: d.method,
        categoryId: d.categoryId,
        description: d.description,
        occurredAt,
      },
      select: { id: true },
    });
    return entryDTOOrThrow(tx, e.id);
  });
}

/** Edição completa (substitui todos os campos). Só lançamentos manuais. */
export async function updateCashEntry(
  db: Db,
  id: unknown,
  input: unknown,
  now: Date = new Date(),
): Promise<ActionResult<CashEntryDTO>> {
  const eid = idSchema.safeParse(id);
  if (!eid.success) return fail(CASH_MSG.invalidId);
  const p = cashEntryInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  if (d.occurredAt && d.occurredAt.getTime() > now.getTime()) {
    return fail(CASH_MSG.futureDate, { occurredAt: CASH_MSG.futureDate });
  }
  return run(db, async (tx) => {
    const cur = await tx.cashEntry.findUnique({
      where: { id: eid.data },
      select: {
        serviceOrderId: true,
        categoryId: true,
        occurredAt: true,
        stockMovements: { select: { id: true }, take: 1 },
      },
    });
    if (!cur) throw new DomainError(CASH_MSG.entryNotFound);
    const allowed = canEditCashEntry({ ...cur, stockMovementId: cur.stockMovements[0]?.id });
    if (!allowed.ok) throw new DomainError(allowed.error);
    await checkCategory(tx, d.categoryId, d.direction, cur.categoryId);
    await tx.cashEntry.update({
      where: { id: eid.data },
      data: {
        direction: d.direction,
        amountCents: d.amountCents,
        method: d.method,
        categoryId: d.categoryId,
        description: d.description,
        // Sem data informada na edição, mantém a original.
        occurredAt: d.occurredAt ?? cur.occurredAt,
      },
    });
    return entryDTOOrThrow(tx, eid.data);
  });
}

export async function deleteCashEntry(db: Db, id: unknown): Promise<ActionResult<{ id: number }>> {
  const eid = idSchema.safeParse(id);
  if (!eid.success) return fail(CASH_MSG.invalidId);
  return run(db, async (tx) => {
    const cur = await tx.cashEntry.findUnique({
      where: { id: eid.data },
      select: {
        serviceOrderId: true,
        categoryId: true,
        stockMovements: { select: { id: true }, take: 1 },
      },
    });
    if (!cur) throw new DomainError(CASH_MSG.entryNotFound);
    const allowed = canEditCashEntry({ ...cur, stockMovementId: cur.stockMovements[0]?.id });
    if (!allowed.ok) throw new DomainError(allowed.error);
    // Condição na própria exclusão: nunca remove um pagamento de OS, mesmo em corrida.
    const r = await tx.cashEntry.deleteMany({ where: { id: eid.data, serviceOrderId: null } });
    if (r.count === 0) throw new DomainError(CASH_MSG.entryNotFound);
    return { id: eid.data };
  });
}

export async function getCashEntry(db: Client, id: unknown): Promise<CashEntryDTO | null> {
  const eid = idSchema.safeParse(id);
  if (!eid.success) return null;
  const r = await db.cashEntry.findUnique({ where: { id: eid.data }, include: entryInclude });
  return r ? toEntryDTO(r) : null;
}

// ---------- Categorias ----------

export type CashCategoryDTO = {
  id: number;
  name: string;
  direction: CashDirection;
  active: boolean;
  isSystem: boolean;
  systemKey: SystemCategoryKey | null;
  /** Quantidade de lançamentos que usam a categoria. */
  usageCount: number;
  canRename: boolean;
  canChangeDirection: boolean;
  canDelete: boolean;
  /** false = o sistema depende dela (ex.: "Compra de produtos"). */
  canInactivate: boolean;
};

function toCategoryDTO(
  c: { id: number; name: string; direction: CashDirection; active: boolean },
  usageCount: number,
): CashCategoryDTO {
  const key = systemCategoryKey(c);
  const sys = SYSTEM_CASH_CATEGORIES.find((s) => s.key === key);
  return {
    ...c,
    isSystem: key !== null,
    systemKey: key,
    usageCount,
    canRename: key === null,
    canChangeDirection: key === null && usageCount === 0,
    canDelete: key === null && usageCount === 0,
    canInactivate: sys ? sys.inactivatable : true,
  };
}

/**
 * Lista categorias (ativas por padrão; `includeInactive` traz todas). Garante que as categorias de
 * sistema existam (e, se a tabela estiver vazia, as padrão), então funciona em produção sem seed manual.
 * Para o formulário de novo lançamento: `{ direction }` com ativas apenas.
 */
export async function listCashCategories(
  db: Db,
  input: { direction?: CashDirection; includeInactive?: boolean } = {},
): Promise<CashCategoryDTO[]> {
  if ((await db.cashCategory.count()) === 0) await ensureDefaultCashCategories(db);
  else await ensureSystemCashCategories(db);
  const rows = await db.cashCategory.findMany({
    where: {
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ direction: "asc" }, { name: "asc" }],
  });
  const usage = await db.cashEntry.groupBy({
    by: ["categoryId"],
    where: { categoryId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const used = new Map(usage.map((u) => [u.categoryId, u._count._all]));
  const dtos = rows.map((r) => toCategoryDTO(r, used.get(r.id) ?? 0));
  // Entradas primeiro; dentro de cada tipo, ordem alfabética sem acento.
  return dtos.sort(
    (a, b) =>
      a.direction.localeCompare(b.direction) || foldText(a.name).localeCompare(foldText(b.name)),
  );
}

async function nameTaken(tx: Client, name: string, direction: CashDirection, exceptId?: number) {
  const same = await tx.cashCategory.findMany({
    where: { direction, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  });
  const folded = foldText(name);
  return same.some((c) => foldText(c.name) === folded);
}

async function usageOf(tx: Client, id: number): Promise<number> {
  return tx.cashEntry.count({ where: { categoryId: id } });
}

async function categoryDTOOrThrow(tx: Client, id: number): Promise<CashCategoryDTO> {
  const c = await tx.cashCategory.findUnique({ where: { id } });
  if (!c) throw new DomainError(CASH_MSG.categoryNotFound);
  return toCategoryDTO(c, await usageOf(tx, id));
}

export async function createCashCategory(
  db: Db,
  input: unknown,
): Promise<ActionResult<CashCategoryDTO>> {
  const p = createCategorySchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const { name, direction } = p.data;
  return run(db, async (tx) => {
    if (await nameTaken(tx, name, direction)) {
      throw new DomainError(CASH_MSG.categoryDuplicate, { name: CASH_MSG.categoryDuplicate });
    }
    const c = await tx.cashCategory.create({ data: { name, direction }, select: { id: true } });
    return categoryDTOOrThrow(tx, c.id);
  });
}

export async function updateCashCategory(
  db: Db,
  id: unknown,
  input: unknown,
): Promise<ActionResult<CashCategoryDTO>> {
  const cid = idSchema.safeParse(id);
  if (!cid.success) return fail(CASH_MSG.invalidId);
  const p = updateCategorySchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const d = p.data;
  if (d.name === undefined && d.direction === undefined) return fail(CASH_MSG.nothingToUpdate);
  return run(db, async (tx) => {
    const c = await tx.cashCategory.findUnique({ where: { id: cid.data } });
    if (!c) throw new DomainError(CASH_MSG.categoryNotFound);
    const isSystem = systemCategoryKey(c) !== null;
    const renaming = d.name !== undefined && d.name !== c.name;
    const redirecting = d.direction !== undefined && d.direction !== c.direction;
    if (isSystem && renaming)
      throw new DomainError(CASH_MSG.systemRename, { name: CASH_MSG.systemRename });
    if (isSystem && redirecting) {
      throw new DomainError(CASH_MSG.systemDirection, { direction: CASH_MSG.systemDirection });
    }
    if (redirecting && (await usageOf(tx, c.id)) > 0) {
      throw new DomainError(CASH_MSG.usedDirection, { direction: CASH_MSG.usedDirection });
    }
    const name = d.name ?? c.name;
    const direction = d.direction ?? c.direction;
    if ((renaming || redirecting) && (await nameTaken(tx, name, direction, c.id))) {
      throw new DomainError(CASH_MSG.categoryDuplicate, { name: CASH_MSG.categoryDuplicate });
    }
    await tx.cashCategory.update({ where: { id: c.id }, data: { name, direction } });
    return categoryDTOOrThrow(tx, c.id);
  });
}

export async function setCashCategoryActive(
  db: Db,
  id: unknown,
  active: unknown,
): Promise<ActionResult<CashCategoryDTO>> {
  const cid = idSchema.safeParse(id);
  if (!cid.success || typeof active !== "boolean") return fail(CASH_MSG.invalidId);
  return run(db, async (tx) => {
    const c = await tx.cashCategory.findUnique({ where: { id: cid.data } });
    if (!c) throw new DomainError(CASH_MSG.categoryNotFound);
    const sys = SYSTEM_CASH_CATEGORIES.find(
      (s) => s.name === c.name && s.direction === c.direction,
    );
    if (!active && sys && !sys.inactivatable) throw new DomainError(CASH_MSG.systemInactivate);
    await tx.cashCategory.update({ where: { id: c.id }, data: { active } });
    return categoryDTOOrThrow(tx, c.id);
  });
}

/** Exclusão definitiva: só categoria que não é de sistema e nunca foi usada (FK Restrict é a última defesa). */
export async function deleteCashCategory(
  db: Db,
  id: unknown,
): Promise<ActionResult<{ id: number }>> {
  const cid = idSchema.safeParse(id);
  if (!cid.success) return fail(CASH_MSG.invalidId);
  try {
    return await run(db, async (tx) => {
      const c = await tx.cashCategory.findUnique({ where: { id: cid.data } });
      if (!c) throw new DomainError(CASH_MSG.categoryNotFound);
      if (systemCategoryKey(c) !== null) throw new DomainError(CASH_MSG.systemDelete);
      if ((await usageOf(tx, c.id)) > 0) throw new DomainError(CASH_MSG.usedDelete);
      await tx.cashCategory.delete({ where: { id: c.id } });
      return { id: c.id };
    });
  } catch (e) {
    // Lançamento criado em paralelo: a FK Restrict barrou a exclusão.
    if ((e as { code?: string }).code === "P2003") return fail(CASH_MSG.usedDelete);
    throw e;
  }
}

// ---------- Consultas por período ----------

export type MethodTotals = { inCents: number; outCents: number; netCents: number };

export type CashSummary = {
  period: { preset: ResolvedPeriod["preset"]; from: string; to: string };
  inCents: number;
  outCents: number;
  /** entradas − saídas dentro do período */
  resultCents: number;
  /** saldo do caixa até o fim do período: Σ entradas − Σ saídas (tudo até `to`) */
  balanceCents: number;
  /** saldo no início do período (= balanceCents − resultCents) */
  openingBalanceCents: number;
  entryCount: number;
  byMethod: Record<PaymentMethod, MethodTotals>;
  /** Pagamentos de atendimento aparecem como categoryId null / "Atendimentos". */
  byCategory: {
    categoryId: number | null;
    name: string;
    direction: CashDirection;
    totalCents: number;
    count: number;
  }[];
};

const METHODS: PaymentMethod[] = ["CASH", "PIX", "DEBIT_CARD", "CREDIT_CARD"];

function periodOf(input: unknown, now: Date): ResolvedPeriod {
  const p = periodInputSchema.safeParse(input ?? {});
  return resolvePeriod(p.success ? p.data : {}, now);
}

export async function getCashSummary(
  db: Client,
  input: unknown = {},
  now: Date = new Date(),
): Promise<CashSummary> {
  const per = periodOf(input, now);
  const where = { occurredAt: { gte: per.from, lte: per.to } };

  const [upToEnd, byDirMethod, byCat] = await Promise.all([
    db.cashEntry.groupBy({
      by: ["direction"],
      where: { occurredAt: { lte: per.to } },
      _sum: { amountCents: true },
    }),
    db.cashEntry.groupBy({
      by: ["direction", "method"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db.cashEntry.groupBy({
      by: ["direction", "categoryId"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);

  const sumDir = (
    rows: { direction: CashDirection; _sum: { amountCents: number | null } }[],
    d: CashDirection,
  ) => rows.filter((r) => r.direction === d).reduce((a, r) => a + (r._sum.amountCents ?? 0), 0);

  const byMethod = Object.fromEntries(
    METHODS.map((m) => [m, { inCents: 0, outCents: 0, netCents: 0 }]),
  ) as Record<PaymentMethod, MethodTotals>;
  let entryCount = 0;
  for (const r of byDirMethod) {
    const t = byMethod[r.method];
    const v = r._sum.amountCents ?? 0;
    if (r.direction === "IN") t.inCents += v;
    else t.outCents += v;
    t.netCents = t.inCents - t.outCents;
    entryCount += r._count._all;
  }

  const catIds = byCat.map((r) => r.categoryId).filter((x): x is number => x !== null);
  const cats = await db.cashCategory.findMany({
    where: { id: { in: catIds } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(cats.map((c) => [c.id, c.name]));
  const byCategory = byCat
    .map((r) => ({
      categoryId: r.categoryId,
      name: r.categoryId === null ? "Atendimentos" : (nameOf.get(r.categoryId) ?? "Categoria"),
      direction: r.direction,
      totalCents: r._sum.amountCents ?? 0,
      count: r._count._all,
    }))
    .sort(
      (a, b) =>
        a.direction.localeCompare(b.direction) ||
        b.totalCents - a.totalCents ||
        a.name.localeCompare(b.name),
    );

  const inCents = sumDir(byDirMethod, "IN");
  const outCents = sumDir(byDirMethod, "OUT");
  const balanceCents = sumDir(upToEnd, "IN") - sumDir(upToEnd, "OUT");
  const resultCents = inCents - outCents;
  return {
    period: { preset: per.preset, from: per.fromYmd, to: per.toYmd },
    inCents,
    outCents,
    resultCents,
    balanceCents,
    openingBalanceCents: balanceCents - resultCents,
    entryCount,
    byMethod,
    byCategory,
  };
}

export type CashEntryList = {
  period: CashSummary["period"];
  items: CashEntryDTO[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
};

/** Extrato do período, mais recente primeiro. `q`: descrição, categoria, cliente, "atendimento"/número da OS. */
export async function listCashEntries(
  db: Client,
  input: unknown = {},
  now: Date = new Date(),
): Promise<CashEntryList> {
  const parsed = listEntriesSchema.safeParse(input ?? {});
  const f = parsed.success ? parsed.data : listEntriesSchema.parse({});
  const per = resolvePeriod(f, now);
  const where: Prisma.CashEntryWhereInput = {
    occurredAt: { gte: per.from, lte: per.to },
    ...(f.direction ? { direction: f.direction } : {}),
    ...(f.method ? { method: f.method } : {}),
    ...(f.categoryId === "ORDERS"
      ? { serviceOrderId: { not: null } }
      : f.categoryId
        ? { categoryId: f.categoryId }
        : {}),
  };
  const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
  const q = foldText(f.q ?? "");
  let items: CashEntryDTO[];
  let total: number;
  const skip = (f.page - 1) * f.limit;
  if (!q) {
    const [rows, count] = await Promise.all([
      db.cashEntry.findMany({ where, orderBy, skip, take: f.limit, include: entryInclude }),
      db.cashEntry.count({ where }),
    ]);
    items = rows.map(toEntryDTO);
    total = count;
  } else {
    // Busca sem acento/caixa em colunas sem versão "dobrada": filtra em memória (volume baixo).
    const rows = await db.cashEntry.findMany({ where, orderBy, include: entryInclude });
    const matched = rows.filter((r) => {
      const hay = foldText(
        [
          r.description,
          r.category?.name,
          r.serviceOrder
            ? `atendimento ${r.serviceOrder.id} #${r.serviceOrder.id} nº ${r.serviceOrder.id}`
            : null,
          r.serviceOrder?.customer.name,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return hay.includes(q);
    });
    total = matched.length;
    items = matched.slice(skip, skip + f.limit).map(toEntryDTO);
  }
  return {
    period: { preset: per.preset, from: per.fromYmd, to: per.toYmd },
    items,
    total,
    page: f.page,
    limit: f.limit,
    pageCount: Math.max(1, Math.ceil(total / f.limit)),
  };
}
