// Estoque (E8): entradas, baixas, acertos, invariantes e proteção da SALE. Roda em SQLite e em Postgres (test:pg).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDefaultCashCategories } from "@/server/cash/categories";
import { canEditCashEntry, deleteCashEntry, updateCashEntry } from "@/server/cash/domain";
import {
  canHardDelete,
  createProduct,
  deleteProduct,
  updateProduct,
} from "@/server/catalog/domain";
import { createService } from "@/server/catalog/domain";
import { createCustomer, createVehicle } from "@/server/customers/domain";
import { createTestDb } from "@/server/customers/test-db";
import {
  cancelOrder,
  completeOrder,
  createOrder,
  registerPayment,
  updateOrder,
  type ActionResult,
} from "@/server/orders/domain";
import {
  adjustStock,
  deleteStockMovement,
  getLowStockSummary,
  getProductStockHistory,
  recomputeProductStock,
  registerStockIn,
  registerStockOut,
  searchStock,
  STOCK_MSG,
  sumProductStock,
  updateStockMovement,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

const NOW = new Date("2026-10-01T15:00:00.000Z");

const okOf = <T>(r: ActionResult<T>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

beforeEach(async () => {
  await db.stockMovement.deleteMany();
  await db.cashEntry.deleteMany();
  await db.serviceOrderItem.deleteMany();
  await db.serviceOrder.deleteMany();
  await db.vehicle.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany();
  await db.product.deleteMany();
  await ensureDefaultCashCategories(db);
});

async function product(name = "Cera líquida", extra: Record<string, unknown> = {}) {
  const r = await createProduct(db, { name, unit: "frasco", ...extra });
  return okOf(r).id;
}

const stockOf = async (id: number) =>
  (await db.product.findUniqueOrThrow({ where: { id } })).stockQuantity;

/** Invariante central: cache = Σ movimentações. */
async function expectInvariant(id: number) {
  const cache = await stockOf(id);
  const sum = await db.stockMovement.aggregate({
    where: { productId: id },
    _sum: { quantity: true },
  });
  expect(cache).toBe(sum._sum.quantity ?? 0);
  expect(cache).toBeGreaterThanOrEqual(0);
}

const IN = (productId: number, quantity: number, extra: Record<string, unknown> = {}) =>
  registerStockIn(db, { productId, quantity, ...extra }, NOW);
const OUT = (productId: number, quantity: number, reason = "Uso") =>
  registerStockOut(db, { productId, quantity, reason }, NOW);

describe("entrada", () => {
  it("sem compra no caixa: soma o estoque e o caixa não muda", async () => {
    const id = await product();
    const r = okOf(await IN(id, 10, { reason: "Fornecedor X" }));
    expect(r.stockQuantity).toBe(10);
    expect(r.movement).toMatchObject({
      type: "IN",
      quantity: 10,
      reason: "Fornecedor X",
      cashEntry: null,
      balanceAfter: 10,
      editable: true,
    });
    expect(await db.cashEntry.count()).toBe(0);
    await expectInvariant(id);
  });

  it("com compra no caixa: cria saída em 'Compra de produtos' ligada à movimentação", async () => {
    const id = await product();
    const r = okOf(await IN(id, 10, { purchase: { amountCents: 25000, method: "PIX" } }));
    expect(r.movement.cashEntry).toMatchObject({ amountCents: 25000, method: "PIX" });
    const entries = await db.cashEntry.findMany({ include: { category: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      direction: "OUT",
      amountCents: 25000,
      method: "PIX",
      serviceOrderId: null,
    });
    expect(entries[0].category?.name).toBe("Compra de produtos");
    expect(entries[0].occurredAt).toEqual(NOW);
    const m = await db.stockMovement.findFirstOrThrow();
    expect(m.cashEntryId).toBe(entries[0].id);
  });

  it("funciona mesmo sem as categorias de sistema (as garante)", async () => {
    await db.cashEntry.deleteMany();
    await db.cashCategory.deleteMany();
    const id = await product();
    okOf(await IN(id, 1, { purchase: { amountCents: 100, method: "CASH" } }));
    expect(await db.cashCategory.count({ where: { name: "Compra de produtos" } })).toBe(1);
  });

  it("valida quantidade, data futura e valores (Zod) sem gravar nada", async () => {
    const id = await product();
    const bad = async (input: Record<string, unknown>) => {
      const r = await IN(id, 1, input);
      expect(r.ok).toBe(false);
      return r;
    };
    for (const q of [0, -3, 1.5, 1_000_000]) {
      const r = await registerStockIn(db, { productId: id, quantity: q }, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.quantity).toBeTruthy();
    }
    const fut = await bad({ occurredAt: "2026-10-02T15:00:00.000Z" });
    if (!fut.ok) expect(fut.fieldErrors?.occurredAt).toBe(STOCK_MSG.futureDate);
    const p1 = await bad({ purchase: { amountCents: 0, method: "PIX" } });
    if (!p1.ok) expect(p1.fieldErrors?.["purchase.amountCents"]).toBeTruthy();
    await bad({ purchase: { amountCents: 10.5, method: "PIX" } });
    const p2 = await bad({ purchase: { amountCents: 100, method: "FIADO" } });
    if (!p2.ok) expect(p2.fieldErrors?.["purchase.method"]).toBeTruthy();
    await bad({ reason: "x".repeat(201) });
    await bad({ occurredAt: "not-a-date" });
    expect((await registerStockIn(db, { productId: 0, quantity: 1 }, NOW)).ok).toBe(false);
    expect(await db.stockMovement.count()).toBe(0);
    expect(await db.cashEntry.count()).toBe(0);
  });

  it("produto inexistente e produto inativo (bloqueia entrada e baixa)", async () => {
    const miss = await IN(999999, 1);
    expect(miss).toMatchObject({ ok: false, error: STOCK_MSG.productNotFound });
    const id = await product();
    okOf(await IN(id, 5));
    await db.product.update({ where: { id }, data: { active: false } });
    expect(await IN(id, 1)).toMatchObject({ ok: false, error: STOCK_MSG.productInactive });
    expect(await OUT(id, 1)).toMatchObject({ ok: false, error: STOCK_MSG.productInactive });
    // acerto continua permitido
    expect(
      okOf(await adjustStock(db, { productId: id, countedQuantity: 3 }, NOW)).stockQuantity,
    ).toBe(3);
    expect(await stockOf(id)).toBe(3);
  });

  it("falha no meio desfaz tudo (transação): despesa não fica órfã", async () => {
    const id = await product();
    await db.product.update({ where: { id }, data: { active: false } });
    await IN(id, 1, { purchase: { amountCents: 500, method: "PIX" } });
    expect(await db.cashEntry.count()).toBe(0);
  });
});

describe("baixa", () => {
  it("subtrai e grava delta negativo", async () => {
    const id = await product();
    okOf(await IN(id, 10));
    const r = okOf(await OUT(id, 3, "Acabou o frasco"));
    expect(r.stockQuantity).toBe(7);
    expect(r.movement).toMatchObject({ type: "OUT", quantity: -3, balanceAfter: 7 });
    await expectInvariant(id);
  });

  it("acima do disponível é rejeitada, com produto e saldo na mensagem", async () => {
    const id = await product("Shampoo");
    okOf(await IN(id, 2));
    const r = await OUT(id, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Shampoo");
      expect(r.error).toContain("disponível 2");
      expect(r.fieldErrors?.quantity).toBe(r.error);
    }
    expect(await stockOf(id)).toBe(2);
    expect((await OUT(id, 2)).ok).toBe(true); // exatamente o saldo pode
    expect(await stockOf(id)).toBe(0);
  });

  it("exige motivo e quantidade inteira > 0", async () => {
    const id = await product();
    okOf(await IN(id, 5));
    const noReason = await registerStockOut(db, { productId: id, quantity: 1, reason: "  " }, NOW);
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.fieldErrors?.reason).toBeTruthy();
    for (const q of [0, -1, 0.5]) expect((await OUT(id, q)).ok).toBe(false);
    expect(await stockOf(id)).toBe(5);
  });
});

describe("acerto de inventário", () => {
  it("recebe a contagem e grava o delta (contagem 5 com 12 -> -7)", async () => {
    const id = await product();
    okOf(await IN(id, 12));
    const r = okOf(
      await adjustStock(db, { productId: id, countedQuantity: 5, reason: "Inventário" }, NOW),
    );
    expect(r.stockQuantity).toBe(5);
    expect(r.movement).toMatchObject({ type: "ADJUSTMENT", quantity: -7, balanceAfter: 5 });
    await expectInvariant(id);
    // para cima
    const up = okOf(await adjustStock(db, { productId: id, countedQuantity: 9 }, NOW));
    expect(up.movement.quantity).toBe(4);
    // zerar
    expect(
      okOf(await adjustStock(db, { productId: id, countedQuantity: 0 }, NOW)).stockQuantity,
    ).toBe(0);
  });

  it("contagem igual ao saldo é recusada; inválidas também", async () => {
    const id = await product();
    okOf(await IN(id, 4));
    const same = await adjustStock(db, { productId: id, countedQuantity: 4 }, NOW);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.fieldErrors?.countedQuantity).toContain("Nada a ajustar");
    for (const c of [-1, 2.5, "x"]) {
      expect((await adjustStock(db, { productId: id, countedQuantity: c }, NOW)).ok).toBe(false);
    }
    expect(await db.stockMovement.count({ where: { type: "ADJUSTMENT" } })).toBe(0);
  });

  it("produto novo (saldo 0): contar 6 gera +6", async () => {
    const id = await product();
    expect(
      okOf(await adjustStock(db, { productId: id, countedQuantity: 6 }, NOW)).movement.quantity,
    ).toBe(6);
  });
});

describe("invariante: estoque = Σ movimentações", () => {
  it("após uma sequência mista de operações, edições e exclusões", async () => {
    const id = await product();
    const a = okOf(await IN(id, 20, { purchase: { amountCents: 9000, method: "CASH" } }));
    await expectInvariant(id);
    const b = okOf(await OUT(id, 5));
    await expectInvariant(id);
    okOf(await adjustStock(db, { productId: id, countedQuantity: 10 }, NOW));
    await expectInvariant(id);
    okOf(await updateStockMovement(db, b.movement.id, { quantity: 2 }, NOW));
    await expectInvariant(id);
    okOf(await deleteStockMovement(db, b.movement.id));
    await expectInvariant(id);
    okOf(await updateStockMovement(db, a.movement.id, { quantity: 30, purchase: null }, NOW));
    await expectInvariant(id);
    expect((await OUT(id, 1000)).ok).toBe(false);
    await expectInvariant(id);
    // IN 30 (editada), ajuste -5 (20 - 5 contado como 15 na época), baixa excluída
    expect(await stockOf(id)).toBe(25);
  });

  it("recomputeProductStock corrige um cache adulterado e recusa soma negativa", async () => {
    const id = await product();
    okOf(await IN(id, 8));
    await db.product.update({ where: { id }, data: { stockQuantity: 999 } });
    await db.$transaction(async (tx) => {
      expect(await recomputeProductStock(tx, id)).toBe(8);
    });
    expect(await stockOf(id)).toBe(8);
    // soma negativa forçada por SQL de teste: o invariante lança
    await db.stockMovement.create({
      data: { productId: id, type: "OUT", quantity: -20, occurredAt: NOW },
    });
    await expect(db.$transaction((tx) => recomputeProductStock(tx, id))).rejects.toThrow(
      STOCK_MSG.invariantNegative,
    );
  });
});

describe("concorrência", () => {
  it("várias baixas simultâneas não passam do saldo", async () => {
    const id = await product();
    okOf(await IN(id, 6));
    const results = await Promise.all(Array.from({ length: 12 }, () => OUT(id, 1)));
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(results.filter((r) => !r.ok)).toHaveLength(6);
    expect(await stockOf(id)).toBe(0);
    await expectInvariant(id);
  });

  it("baixas de 2 unidades sobre saldo 5: só duas passam", async () => {
    const id = await product();
    okOf(await IN(id, 5));
    const results = await Promise.all(Array.from({ length: 6 }, () => OUT(id, 2)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await stockOf(id)).toBe(1);
    await expectInvariant(id);
  });

  it("entrada e baixa simultâneas mantêm o invariante", async () => {
    const id = await product();
    okOf(await IN(id, 3));
    await Promise.all([IN(id, 4), OUT(id, 2), IN(id, 1), OUT(id, 1)]);
    expect(await stockOf(id)).toBe(3 + 4 + 1 - 2 - 1);
    await expectInvariant(id);
  });
});

/** Cria uma movimentação SALE por SQL (a E9 fará pelo atendimento). */
async function makeSale(productId: number, qty: number) {
  const c = await db.customer.create({ data: { name: "Maria", searchName: "maria" } });
  const o = await db.serviceOrder.create({
    data: { customerId: c.id, status: "DONE", totalCents: 1000 },
  });
  const item = await db.serviceOrderItem.create({
    data: {
      orderId: o.id,
      kind: "PRODUCT",
      productId,
      description: "Cera",
      quantity: qty,
      unitPriceCents: 1000,
      totalCents: 1000 * qty,
    },
  });
  const m = await db.stockMovement.create({
    data: {
      productId,
      type: "SALE",
      quantity: -qty,
      serviceOrderItemId: item.id,
      occurredAt: NOW,
      reason: `Venda OS nº ${o.id}`,
    },
  });
  await db.$transaction((tx) => recomputeProductStock(tx, productId));
  return { movement: m, orderId: o.id };
}

describe("SALE protegida", () => {
  it("editar e excluir são recusados ('pelo atendimento'); estoque intacto", async () => {
    const id = await product();
    okOf(await IN(id, 10));
    const { movement } = await makeSale(id, 3);
    expect(await stockOf(id)).toBe(7);
    const u = await updateStockMovement(db, movement.id, { quantity: 1 }, NOW);
    expect(u).toMatchObject({ ok: false, error: STOCK_MSG.saleLocked });
    expect(STOCK_MSG.saleLocked).toContain("atendimento");
    const d = await deleteStockMovement(db, movement.id);
    expect(d).toMatchObject({ ok: false, error: STOCK_MSG.saleLocked });
    expect(await stockOf(id)).toBe(7);
    expect(await db.stockMovement.count({ where: { type: "SALE" } })).toBe(1);
  });

  it("aparece no histórico com orderId e travada; baixa respeita o saldo após a venda", async () => {
    const id = await product();
    okOf(await IN(id, 10));
    const { orderId } = await makeSale(id, 4);
    const h = (await getProductStockHistory(db, id))!;
    const sale = h.movements.find((m) => m.type === "SALE")!;
    expect(sale).toMatchObject({ orderId, editable: false, quantity: -4 });
    expect(sale.lockedReason).toBe(STOCK_MSG.saleLocked);
    expect((await OUT(id, 7)).ok).toBe(false); // saldo 6
    expect((await OUT(id, 6)).ok).toBe(true);
  });

  it("excluir uma entrada que já foi vendida (estoque ficaria negativo) é recusado", async () => {
    const id = await product();
    const a = okOf(await IN(id, 5));
    await makeSale(id, 5);
    const r = await deleteStockMovement(db, a.movement.id);
    expect(r.ok).toBe(false);
    expect(await stockOf(id)).toBe(0);
  });

  it("o banco impede apagar item/produto com SALE (Restrict)", async () => {
    const id = await product();
    okOf(await IN(id, 5));
    const { movement } = await makeSale(id, 2);
    await expect(
      db.serviceOrderItem.delete({ where: { id: movement.serviceOrderItemId! } }),
    ).rejects.toThrow();
    await expect(db.product.delete({ where: { id } })).rejects.toThrow();
  });
});

describe("editar e excluir movimentações manuais", () => {
  it("editar quantidade recalcula; negativo é recusado", async () => {
    const id = await product();
    const a = okOf(await IN(id, 10));
    okOf(await OUT(id, 8)); // saldo 2
    const bad = await updateStockMovement(db, a.movement.id, { quantity: 5 }, NOW); // 5 - 8 < 0
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors?.quantity).toContain("negativo");
    expect(await stockOf(id)).toBe(2);
    const ok = okOf(
      await updateStockMovement(db, a.movement.id, { quantity: 12, reason: "Corrigido" }, NOW),
    );
    expect(ok.stockQuantity).toBe(4);
    expect(ok.movement.reason).toBe("Corrigido");
    // reason null remove; ausente mantém
    expect(
      okOf(await updateStockMovement(db, a.movement.id, { quantity: 12 }, NOW)).movement.reason,
    ).toBe("Corrigido");
    expect(
      okOf(await updateStockMovement(db, a.movement.id, { quantity: 12, reason: "" }, NOW)).movement
        .reason,
    ).toBeNull();
  });

  it("OUT: quantidade positiva, sinal vem do tipo; ADJUSTMENT aceita delta com sinal", async () => {
    const id = await product();
    okOf(await IN(id, 10));
    const o = okOf(await OUT(id, 2));
    expect(
      okOf(await updateStockMovement(db, o.movement.id, { quantity: 4 }, NOW)).movement.quantity,
    ).toBe(-4);
    expect((await updateStockMovement(db, o.movement.id, { quantity: -4 }, NOW)).ok).toBe(false);
    expect((await updateStockMovement(db, o.movement.id, { quantity: 0 }, NOW)).ok).toBe(false);
    const adj = okOf(await adjustStock(db, { productId: id, countedQuantity: 3 }, NOW)); // delta -3 (saldo 6 -> 3)
    expect(adj.movement.quantity).toBe(-3);
    expect(
      okOf(await updateStockMovement(db, adj.movement.id, { quantity: -1 }, NOW)).movement.quantity,
    ).toBe(-1);
    expect(
      okOf(await updateStockMovement(db, adj.movement.id, { quantity: 2 }, NOW)).movement.quantity,
    ).toBe(2);
    expect((await updateStockMovement(db, adj.movement.id, { quantity: 0 }, NOW)).ok).toBe(false);
    await expectInvariant(id);
  });

  it("excluir entrada com compra: a despesa vinculada é excluída junto", async () => {
    const id = await product();
    const a = okOf(await IN(id, 10, { purchase: { amountCents: 5000, method: "DEBIT_CARD" } }));
    const cashId = a.movement.cashEntry!.id;
    const r = okOf(await deleteStockMovement(db, a.movement.id));
    expect(r).toMatchObject({ stockQuantity: 0, removedCashEntryId: cashId });
    expect(await db.cashEntry.count()).toBe(0);
    expect(await db.stockMovement.count()).toBe(0);
    await expectInvariant(id);
  });

  it("excluir recusado (estoque negativo) não apaga a despesa", async () => {
    const id = await product();
    const a = okOf(await IN(id, 10, { purchase: { amountCents: 5000, method: "PIX" } }));
    okOf(await OUT(id, 6));
    const r = await deleteStockMovement(db, a.movement.id);
    expect(r.ok).toBe(false);
    expect(await db.cashEntry.count()).toBe(1);
    expect(await stockOf(id)).toBe(4);
  });

  it("editar a compra: atualiza valor/forma/data da despesa; null remove; objeto cria", async () => {
    const id = await product();
    const a = okOf(await IN(id, 10, { purchase: { amountCents: 5000, method: "PIX" } }));
    const upd = okOf(
      await updateStockMovement(
        db,
        a.movement.id,
        {
          quantity: 10,
          occurredAt: "2026-09-30T12:00:00.000Z",
          purchase: { amountCents: 7000, method: "CASH" },
        },
        NOW,
      ),
    );
    expect(upd.movement.cashEntry).toMatchObject({ amountCents: 7000, method: "CASH" });
    const ce = await db.cashEntry.findFirstOrThrow();
    expect(ce.occurredAt).toEqual(new Date("2026-09-30T12:00:00.000Z"));
    // mantém (purchase ausente): despesa continua e acompanha a data
    okOf(
      await updateStockMovement(
        db,
        a.movement.id,
        { quantity: 10, occurredAt: "2026-09-29T12:00:00.000Z" },
        NOW,
      ),
    );
    expect((await db.cashEntry.findFirstOrThrow()).occurredAt).toEqual(
      new Date("2026-09-29T12:00:00.000Z"),
    );
    // remove
    const rm = okOf(
      await updateStockMovement(db, a.movement.id, { quantity: 10, purchase: null }, NOW),
    );
    expect(rm.movement.cashEntry).toBeNull();
    expect(await db.cashEntry.count()).toBe(0);
    // cria numa entrada sem compra
    const b = okOf(await IN(id, 1));
    const add = okOf(
      await updateStockMovement(
        db,
        b.movement.id,
        { quantity: 1, purchase: { amountCents: 100, method: "PIX" } },
        NOW,
      ),
    );
    expect(add.movement.cashEntry?.amountCents).toBe(100);
    expect(await db.cashEntry.count()).toBe(1);
  });

  it("compra só em entradas; id inválido/inexistente", async () => {
    const id = await product();
    okOf(await IN(id, 5));
    const o = okOf(await OUT(id, 1));
    const r = await updateStockMovement(
      db,
      o.movement.id,
      { quantity: 1, purchase: { amountCents: 1, method: "PIX" } },
      NOW,
    );
    expect(r).toMatchObject({ ok: false, error: STOCK_MSG.purchaseOnlyIn });
    expect(await updateStockMovement(db, "x", { quantity: 1 }, NOW)).toMatchObject({
      ok: false,
      error: STOCK_MSG.invalidId,
    });
    expect(await deleteStockMovement(db, 999999)).toMatchObject({
      ok: false,
      error: STOCK_MSG.movementNotFound,
    });
    expect(await deleteStockMovement(db, 0)).toMatchObject({
      ok: false,
      error: STOCK_MSG.invalidId,
    });
  });

  it("editar/excluir permitido em produto inativo (correção de histórico)", async () => {
    const id = await product();
    const a = okOf(await IN(id, 5));
    await db.product.update({ where: { id }, data: { active: false } });
    expect((await updateStockMovement(db, a.movement.id, { quantity: 6 }, NOW)).ok).toBe(true);
    expect((await deleteStockMovement(db, a.movement.id)).ok).toBe(true);
  });
});

describe("caixa e catálogo (pontos de extensão)", () => {
  it("lançamento de compra é bloqueado no caixa ('edite pelo estoque')", async () => {
    const id = await product();
    const a = okOf(await IN(id, 5, { purchase: { amountCents: 1000, method: "PIX" } }));
    const cashId = a.movement.cashEntry!.id;
    const upd = await updateCashEntry(
      db,
      cashId,
      {
        direction: "OUT",
        amountCents: 1,
        categoryId: (
          await db.cashCategory.findFirstOrThrow({ where: { name: "Compra de produtos" } })
        ).id,
        method: "PIX",
      },
      NOW,
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error).toContain("movimentação do produto");
    const del = await deleteCashEntry(db, cashId);
    expect(del.ok).toBe(false);
    expect(await db.cashEntry.count()).toBe(1);
    expect(canEditCashEntry({ serviceOrderId: null, categoryId: 1, stockMovementId: 3 }).ok).toBe(
      false,
    );
    expect(
      canEditCashEntry({ serviceOrderId: null, categoryId: 1, stockMovementId: null }).ok,
    ).toBe(true);
    // despesa manual comum continua editável
    const m = await db.cashEntry.create({
      data: {
        direction: "OUT",
        amountCents: 100,
        method: "PIX",
        categoryId: (await db.cashCategory.findFirstOrThrow({ where: { name: "Aluguel" } })).id,
        occurredAt: NOW,
      },
    });
    expect((await deleteCashEntry(db, m.id)).ok).toBe(true);
  });

  it("canHardDelete/deleteProduct: produto com movimentações não pode ser excluído", async () => {
    const id = await product("Com histórico");
    const free = await product("Sem histórico");
    expect(await canHardDelete(db, "product", id)).toBe(true);
    okOf(await IN(id, 1));
    expect(await canHardDelete(db, "product", id)).toBe(false);
    const r = await deleteProduct(db, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Inativar");
    expect(await canHardDelete(db, "product", free)).toBe(true);
    expect((await deleteProduct(db, free)).ok).toBe(true);
    // sem movimentações (excluídas) libera de novo
    const mv = await db.stockMovement.findFirstOrThrow();
    okOf(await deleteStockMovement(db, mv.id));
    expect(await canHardDelete(db, "product", id)).toBe(true);
  });

  it("catálogo edita minStockQuantity sem tocar o estoque; ausente mantém, '' limpa, inválido recusa", async () => {
    const id = await product("Cera", { minStockQuantity: 3 });
    okOf(await IN(id, 8));
    const base = { name: "Cera", unit: "frasco" };
    expect(okOf(await updateProduct(db, id, { ...base })).minStockQuantity).toBe(3);
    const u = okOf(await updateProduct(db, id, { ...base, minStockQuantity: 5 }));
    expect(u).toMatchObject({ minStockQuantity: 5, stockQuantity: 8 });
    expect(
      okOf(await updateProduct(db, id, { ...base, minStockQuantity: 0 })).minStockQuantity,
    ).toBe(0);
    expect(
      okOf(await updateProduct(db, id, { ...base, minStockQuantity: "" })).minStockQuantity,
    ).toBeNull();
    for (const bad of [-1, 1.5, 1_000_000]) {
      const r = await updateProduct(db, id, { ...base, minStockQuantity: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.minStockQuantity).toBeTruthy();
    }
    expect(await stockOf(id)).toBe(8);
    // um stockQuantity enviado pelo cliente é ignorado
    okOf(await updateProduct(db, id, { ...base, stockQuantity: 999 }));
    expect(await stockOf(id)).toBe(8);
  });
});

describe("consultas", () => {
  it("searchStock: busca sem acento, inativos, lowOnly e flag low", async () => {
    const a = await product("Cera Líquida", { minStockQuantity: 5 });
    const b = await product("Shampoo", { minStockQuantity: 2 });
    const c = await product("Pretinho");
    okOf(await IN(a, 5)); // 5 <= 5 -> low
    okOf(await IN(b, 3)); // 3 > 2
    okOf(await IN(c, 1)); // sem mínimo
    const all = await searchStock(db);
    expect(all.map((p) => [p.name, p.stockQuantity, p.low])).toEqual([
      ["Cera Líquida", 5, true],
      ["Pretinho", 1, false],
      ["Shampoo", 3, false],
    ]);
    expect((await searchStock(db, { q: "liquida" })).map((p) => p.id)).toEqual([a]);
    expect(await searchStock(db, { q: "%" })).toEqual([]);
    expect((await searchStock(db, { lowOnly: true })).map((p) => p.id)).toEqual([a]);
    await db.product.update({ where: { id: b }, data: { active: false } });
    expect((await searchStock(db)).map((p) => p.id)).not.toContain(b);
    expect((await searchStock(db, { includeInactive: true })).map((p) => p.id)).toContain(b);
    // mínimo 0 e estoque 0 -> low
    const d = await product("Zero", { minStockQuantity: 0 });
    expect((await searchStock(db, { lowOnly: true })).map((p) => p.id).sort()).toEqual(
      [a, d].sort(),
    );
  });

  it("getLowStockSummary: só ativos, mais críticos primeiro", async () => {
    const a = await product("Prod A", { minStockQuantity: 5 });
    const b = await product("Prod B", { minStockQuantity: 5 });
    const c = await product("Prod C", { minStockQuantity: 5 });
    okOf(await IN(a, 4));
    okOf(await IN(b, 1));
    okOf(await IN(c, 4));
    await db.product.update({ where: { id: c }, data: { active: false } });
    const s = await getLowStockSummary(db);
    expect(s.count).toBe(2);
    expect(s.items.map((i) => [i.name, i.stockQuantity, i.minStockQuantity])).toEqual([
      ["Prod B", 1, 5],
      ["Prod A", 4, 5],
    ]);
  });

  it("histórico: mais recente primeiro, saldo após cada movimentação e paginação", async () => {
    const id = await product();
    okOf(
      await registerStockIn(
        db,
        { productId: id, quantity: 10, occurredAt: "2026-09-01T12:00:00.000Z" },
        NOW,
      ),
    );
    okOf(
      await registerStockOut(
        db,
        { productId: id, quantity: 3, reason: "Uso", occurredAt: "2026-09-02T12:00:00.000Z" },
        NOW,
      ),
    );
    okOf(
      await adjustStock(
        db,
        { productId: id, countedQuantity: 5, occurredAt: "2026-09-03T12:00:00.000Z" },
        NOW,
      ),
    );
    const h = (await getProductStockHistory(db, id))!;
    expect(h.movements.map((m) => [m.type, m.quantity, m.balanceAfter])).toEqual([
      ["ADJUSTMENT", -2, 5],
      ["OUT", -3, 7],
      ["IN", 10, 10],
    ]);
    expect(h.total).toBe(3);
    expect(h.product.stockQuantity).toBe(5);
    const p2 = (await getProductStockHistory(db, id, { page: 2, limit: 2 }))!;
    expect(p2.movements).toHaveLength(1);
    expect(p2.movements[0]).toMatchObject({ type: "IN", balanceAfter: 10 });
    expect(p2.pageCount).toBe(2);
    const bad = (await getProductStockHistory(db, id, { page: -4, limit: 99999 }))!;
    expect(bad.page).toBe(1);
    expect(await getProductStockHistory(db, 999999)).toBeNull();
    expect(await getProductStockHistory(db, "x")).toBeNull();
  });
});

describe("regressão: atendimento de serviço não altera estoque", () => {
  it("criar, editar, concluir com pagamento e cancelar OS só de serviços", async () => {
    const pid = await product();
    okOf(await IN(pid, 7));
    const c = okOf(await createCustomer(db, { name: "Maria Silva" }));
    const v = okOf(await createVehicle(db, c.id, { type: "CAR", plate: "ABC1D23" }));
    const s = okOf(await createService(db, { name: "Lavagem", carPriceCents: 5000 }));
    const o = okOf(
      await createOrder(db, { customerId: c.id, vehicleId: v.id, items: [{ serviceId: s.id }] }),
    );
    okOf(await updateOrder(db, o.id, { discountCents: 100 }));
    okOf(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 1000 }]));
    okOf(await registerPayment(db, o.id, { method: "CASH", amountCents: 500 }));
    const o2 = okOf(
      await createOrder(db, { customerId: c.id, vehicleId: v.id, items: [{ serviceId: s.id }] }),
    );
    okOf(await completeOrder(db, o2.id, []));
    okOf(await cancelOrder(db, o2.id));
    expect(await stockOf(pid)).toBe(7);
    expect(await db.stockMovement.count()).toBe(1);
    await expectInvariant(pid);
    expect(await sumProductStock(db, pid)).toBe(7);
  });
});
