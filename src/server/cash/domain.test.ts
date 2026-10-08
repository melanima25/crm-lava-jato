// Caixa (E7): lançamentos manuais, categorias, resumo e extrato. Roda em SQLite e em Postgres (test:pg).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/customers/test-db";
import type { ActionResult } from "@/server/orders/domain";
import {
  canEditCashEntry,
  createCashCategory,
  createCashEntry,
  deleteCashCategory,
  deleteCashEntry,
  getCashEntry,
  getCashSummary,
  listCashCategories,
  listCashEntries,
  setCashCategoryActive,
  updateCashCategory,
  updateCashEntry,
  type CashCategoryDTO,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

// 2026-10-01 12:00 em São Paulo (quinta-feira)
const NOW = new Date("2026-10-01T15:00:00.000Z");

const okOf = <T>(r: ActionResult<T>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

let cats: Record<string, CashCategoryDTO> = {};
const cat = (name: string) => cats[name];

beforeEach(async () => {
  await db.cashEntry.deleteMany();
  await db.serviceOrder.deleteMany();
  await db.customer.deleteMany();
  await db.cashCategory.deleteMany();
  const all = await listCashCategories(db, { includeInactive: true }); // semeia (tabela vazia)
  cats = Object.fromEntries(all.map((c) => [c.name, c]));
});

function entry(over: Record<string, unknown> = {}) {
  return {
    direction: "OUT",
    amountCents: 1000,
    categoryId: cat("Aluguel").id,
    method: "PIX",
    occurredAt: "2026-10-01T10:00:00-03:00",
    ...over,
  };
}

async function orderPayment(
  amountCents: number,
  method: "CASH" | "PIX" | "DEBIT_CARD" | "CREDIT_CARD",
  occurredAt: string,
  customerName = "Maria",
) {
  const c = await db.customer.create({
    data: { name: customerName, searchName: customerName.toLowerCase() },
  });
  const o = await db.serviceOrder.create({
    data: { customerId: c.id, status: "DONE", totalCents: amountCents, paidCents: amountCents },
  });
  return db.cashEntry.create({
    data: {
      direction: "IN",
      amountCents,
      method,
      serviceOrderId: o.id,
      occurredAt: new Date(occurredAt),
    },
  });
}

describe("lançamentos manuais", () => {
  it("cria saída e entrada; entrada de saldo inicial em data passada", async () => {
    const out = okOf(await createCashEntry(db, entry({ description: "  Boleto  " }), NOW));
    expect(out).toMatchObject({
      direction: "OUT",
      amountCents: 1000,
      kind: "MANUAL",
      title: "Aluguel",
      description: "Boleto",
      editable: true,
      orderId: null,
    });
    const opening = okOf(
      await createCashEntry(
        db,
        entry({
          direction: "IN",
          amountCents: 50000,
          categoryId: cat("Saldo inicial / aporte").id,
          method: "CASH",
          occurredAt: "2026-09-01T09:00:00-03:00",
        }),
        NOW,
      ),
    );
    expect(opening.category?.name).toBe("Saldo inicial / aporte");
    expect(opening.description).toBeNull();
  });

  it("sem data informada usa agora; descrição é opcional", async () => {
    const e = okOf(await createCashEntry(db, entry({ occurredAt: undefined }), NOW));
    expect(e.occurredAt.toISOString()).toBe(NOW.toISOString());
  });

  it("valida valor, categoria, método, data e direção (fieldErrors em pt-BR)", async () => {
    const bad = async (over: Record<string, unknown>, field: string) => {
      const r = await createCashEntry(db, entry(over), NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.[field], field).toBeTruthy();
    };
    await bad({ amountCents: 0 }, "amountCents");
    await bad({ amountCents: -5 }, "amountCents");
    await bad({ amountCents: 10.5 }, "amountCents");
    await bad({ amountCents: "10" }, "amountCents");
    await bad({ categoryId: undefined }, "categoryId");
    await bad({ categoryId: 999999 }, "categoryId");
    await bad({ method: "FIADO" }, "method");
    await bad({ method: undefined }, "method");
    await bad({ direction: "X" }, "direction");
    await bad({ occurredAt: "2026-10-01" }, "occurredAt");
    await bad({ description: "x".repeat(201) }, "description");
    expect(await db.cashEntry.count()).toBe(0);
  });

  it("rejeita data futura (e aceita o instante atual)", async () => {
    const r = await createCashEntry(db, entry({ occurredAt: "2026-10-01T12:00:01-03:00" }), NOW);
    expect(r).toMatchObject({
      ok: false,
      error: "A data do lançamento não pode ser futura",
      fieldErrors: { occurredAt: "A data do lançamento não pode ser futura" },
    });
    okOf(await createCashEntry(db, entry({ occurredAt: "2026-10-01T12:00:00-03:00" }), NOW));
    expect(await db.cashEntry.count()).toBe(1);
  });

  it("categoria precisa ser da mesma direção", async () => {
    const r = await createCashEntry(
      db,
      entry({ direction: "IN", categoryId: cat("Aluguel").id }),
      NOW,
    );
    expect(r).toMatchObject({ ok: false, fieldErrors: { categoryId: expect.any(String) } });
    const r2 = await createCashEntry(
      db,
      entry({ direction: "OUT", categoryId: cat("Outras entradas").id }),
      NOW,
    );
    expect(r2.ok).toBe(false);
  });

  it("categoria inativa não aceita novos lançamentos, mas o histórico permanece", async () => {
    const old = okOf(await createCashEntry(db, entry(), NOW));
    okOf(await setCashCategoryActive(db, cat("Aluguel").id, false));
    const r = await createCashEntry(db, entry(), NOW);
    expect(r).toMatchObject({ ok: false, fieldErrors: { categoryId: expect.any(String) } });
    // não aparece para novos lançamentos...
    const forForm = await listCashCategories(db, { direction: "OUT" });
    expect(forForm.map((c) => c.name)).not.toContain("Aluguel");
    // ...mas o lançamento antigo continua no extrato, com a categoria, e pode ser editado sem trocá-la
    const list = await listCashEntries(db, { from: "2026-10-01", to: "2026-10-01" }, NOW);
    expect(list.items[0].category).toMatchObject({ name: "Aluguel", active: false });
    const edited = okOf(await updateCashEntry(db, old.id, entry({ amountCents: 1234 }), NOW));
    expect(edited.amountCents).toBe(1234);
    // trocar para outra inativa é recusado
    okOf(await setCashCategoryActive(db, cat("Água e luz").id, false));
    expect(
      (await updateCashEntry(db, old.id, entry({ categoryId: cat("Água e luz").id }), NOW)).ok,
    ).toBe(false);
  });

  it("edita (todos os campos) e exclui", async () => {
    const e = okOf(await createCashEntry(db, entry(), NOW));
    const u = okOf(
      await updateCashEntry(
        db,
        e.id,
        entry({
          direction: "IN",
          amountCents: 2500,
          categoryId: cat("Outras entradas").id,
          method: "CASH",
          occurredAt: "2026-09-30T10:00:00-03:00",
          description: "Venda de sucata",
        }),
        NOW,
      ),
    );
    expect(u).toMatchObject({
      id: e.id,
      direction: "IN",
      amountCents: 2500,
      method: "CASH",
      title: "Outras entradas",
      description: "Venda de sucata",
    });
    expect(u.occurredAt.toISOString()).toBe("2026-09-30T13:00:00.000Z");
    // categoria de outra direção na edição
    expect((await updateCashEntry(db, e.id, entry({ direction: "IN" }), NOW)).ok).toBe(false);
    // data futura na edição
    expect(
      (await updateCashEntry(db, e.id, entry({ occurredAt: "2026-10-02T00:00:00-03:00" }), NOW)).ok,
    ).toBe(false);
    okOf(await deleteCashEntry(db, e.id));
    expect(await getCashEntry(db, e.id)).toBeNull();
    expect((await deleteCashEntry(db, e.id)).ok).toBe(false);
    expect((await updateCashEntry(db, e.id, entry(), NOW)).ok).toBe(false);
    expect((await deleteCashEntry(db, "abc")).ok).toBe(false);
  });

  it("pagamento de atendimento não é editado nem excluído por aqui", async () => {
    const p = await orderPayment(7000, "PIX", "2026-10-01T15:00:00Z");
    const msg = "Este lançamento é um pagamento de atendimento. Edite ou estorne pelo atendimento.";
    expect(await updateCashEntry(db, p.id, entry(), NOW)).toMatchObject({ ok: false, error: msg });
    expect(await deleteCashEntry(db, p.id)).toMatchObject({ ok: false, error: msg });
    expect(await db.cashEntry.count({ where: { id: p.id } })).toBe(1);
    const dto = await getCashEntry(db, p.id);
    expect(dto).toMatchObject({ editable: false, kind: "ORDER_PAYMENT", lockedReason: msg });
  });

  it("canEditCashEntry: ponto de extensão (OS, estoque, órfão)", () => {
    expect(canEditCashEntry({ serviceOrderId: null, categoryId: 1 })).toEqual({ ok: true });
    expect(canEditCashEntry({ serviceOrderId: 3, categoryId: null }).ok).toBe(false);
    expect(canEditCashEntry({ serviceOrderId: null, categoryId: 1, stockMovementId: 9 }).ok).toBe(
      false,
    );
    expect(canEditCashEntry({ serviceOrderId: null, categoryId: null }).ok).toBe(false);
  });
});

describe("categorias", () => {
  it("semeia categorias padrão e de sistema, com flags", async () => {
    const opening = cat("Saldo inicial / aporte");
    expect(opening).toMatchObject({
      isSystem: true,
      systemKey: "OPENING_BALANCE",
      canDelete: false,
    });
    expect(cat("Compra de produtos")).toMatchObject({
      isSystem: true,
      canInactivate: false,
      canRename: false,
    });
    expect(cat("Aluguel")).toMatchObject({ isSystem: false, canDelete: true, canRename: true });
  });

  it("recria categoria de sistema que faltar (produção sem seed), sem recriar as excluídas", async () => {
    await db.cashCategory.delete({ where: { id: cat("Compra de produtos").id } });
    await db.cashCategory.delete({ where: { id: cat("Aluguel").id } });
    const all = await listCashCategories(db);
    const names = all.map((c) => c.name);
    expect(names).toContain("Compra de produtos");
    expect(names).not.toContain("Aluguel");
  });

  it("nome único por direção, sem diferenciar acento/caixa; mesma palavra em outra direção vale", async () => {
    const a = okOf(
      await createCashCategory(db, { name: "  Lanche  da   equipe ", direction: "OUT" }),
    );
    expect(a.name).toBe("Lanche da equipe");
    const dup = await createCashCategory(db, { name: "LÁNCHE DA EQUIPE", direction: "OUT" });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect((await createCashCategory(db, { name: "agua e luz", direction: "OUT" })).ok).toBe(false);
    okOf(await createCashCategory(db, { name: "Lanche da equipe", direction: "IN" }));
    expect((await createCashCategory(db, { name: "   ", direction: "IN" })).ok).toBe(false);
    expect((await createCashCategory(db, { name: "x", direction: "Z" })).ok).toBe(false);
  });

  it("renomeia (não colide com outra); renomear para o próprio nome em outra caixa vale", async () => {
    const c = okOf(await createCashCategory(db, { name: "Brindes", direction: "OUT" }));
    expect(okOf(await updateCashCategory(db, c.id, { name: "brindes" })).name).toBe("brindes");
    expect((await updateCashCategory(db, c.id, { name: "aluguel" })).ok).toBe(false);
    expect((await updateCashCategory(db, c.id, {})).ok).toBe(false);
  });

  it("direção só muda se a categoria nunca foi usada e não é de sistema", async () => {
    const c = okOf(await createCashCategory(db, { name: "Brindes", direction: "OUT" }));
    expect(okOf(await updateCashCategory(db, c.id, { direction: "IN" })).direction).toBe("IN");
    okOf(await createCashEntry(db, entry({ direction: "IN", categoryId: c.id }), NOW));
    expect(await updateCashCategory(db, c.id, { direction: "OUT" })).toMatchObject({
      ok: false,
      fieldErrors: { direction: expect.any(String) },
    });
    const sys = cat("Compra de produtos");
    expect((await updateCashCategory(db, sys.id, { direction: "IN" })).ok).toBe(false);
    expect((await updateCashCategory(db, sys.id, { name: "Compras" })).ok).toBe(false);
    // renomear categoria usada (não de sistema) é permitido
    expect(okOf(await updateCashCategory(db, c.id, { name: "Brindes 2" })).usageCount).toBe(1);
  });

  it("de sistema: não exclui; 'Compra de produtos' não inativa; 'Saldo inicial' inativa/reativa", async () => {
    expect((await deleteCashCategory(db, cat("Compra de produtos").id)).ok).toBe(false);
    expect((await deleteCashCategory(db, cat("Saldo inicial / aporte").id)).ok).toBe(false);
    expect((await setCashCategoryActive(db, cat("Compra de produtos").id, false)).ok).toBe(false);
    expect(
      okOf(await setCashCategoryActive(db, cat("Saldo inicial / aporte").id, false)).active,
    ).toBe(false);
    expect(
      okOf(await setCashCategoryActive(db, cat("Saldo inicial / aporte").id, true)).active,
    ).toBe(true);
    expect((await setCashCategoryActive(db, cat("Aluguel").id, "x")).ok).toBe(false);
  });

  it("exclui só se nunca usada; usada pede para inativar", async () => {
    const free = okOf(await createCashCategory(db, { name: "Livre", direction: "OUT" }));
    okOf(await deleteCashCategory(db, free.id));
    expect(await db.cashCategory.count({ where: { id: free.id } })).toBe(0);
    okOf(await createCashEntry(db, entry(), NOW));
    const used = await deleteCashCategory(db, cat("Aluguel").id);
    expect(used).toMatchObject({ ok: false, error: expect.stringContaining("Inative") });
    expect((await deleteCashCategory(db, 99999)).ok).toBe(false);
    // depois de excluir o lançamento, libera
    const e = await db.cashEntry.findFirstOrThrow();
    okOf(await deleteCashEntry(db, e.id));
    okOf(await deleteCashCategory(db, cat("Aluguel").id));
  });

  it("lista com contagem de uso e filtros de direção/inativas", async () => {
    okOf(await createCashEntry(db, entry(), NOW));
    okOf(await setCashCategoryActive(db, cat("Água e luz").id, false));
    const outs = await listCashCategories(db, { direction: "OUT" });
    expect(outs.every((c) => c.direction === "OUT" && c.active)).toBe(true);
    expect(outs.find((c) => c.name === "Aluguel")?.usageCount).toBe(1);
    const all = await listCashCategories(db, { includeInactive: true });
    expect(all.some((c) => c.name === "Água e luz" && !c.active)).toBe(true);
    expect(all[0].direction).toBe("IN");
  });
});

describe("resumo por período", () => {
  it("saldo acumulado x resultado do período; fiado não pago não aparece", async () => {
    // saldo inicial em agosto + movimento em setembro + movimento em outubro
    okOf(
      await createCashEntry(
        db,
        entry({
          direction: "IN",
          amountCents: 100000,
          categoryId: cat("Saldo inicial / aporte").id,
          method: "CASH",
          occurredAt: "2026-08-31T08:00:00-03:00",
        }),
        NOW,
      ),
    );
    okOf(
      await createCashEntry(
        db,
        entry({ amountCents: 30000, occurredAt: "2026-09-10T10:00:00-03:00" }),
        NOW,
      ),
    );
    await orderPayment(8000, "PIX", "2026-10-01T13:00:00Z");
    okOf(await createCashEntry(db, entry({ amountCents: 2000 }), NOW));
    // OS concluída no fiado (sem CashEntry): não entra em nada
    const c = await db.customer.create({ data: { name: "Devedor", searchName: "devedor" } });
    await db.serviceOrder.create({
      data: { customerId: c.id, status: "DONE", totalCents: 99999, paidCents: 0 },
    });

    const day = await getCashSummary(db, { from: "2026-10-01", to: "2026-10-01" }, NOW);
    expect(day).toMatchObject({
      inCents: 8000,
      outCents: 2000,
      resultCents: 6000,
      balanceCents: 100000 - 30000 + 8000 - 2000,
      openingBalanceCents: 100000 - 30000,
      entryCount: 2,
    });
    const sep = await getCashSummary(db, { from: "2026-09-01", to: "2026-09-30" }, NOW);
    expect(sep).toMatchObject({
      inCents: 0,
      outCents: 30000,
      resultCents: -30000,
      balanceCents: 70000,
    });
    const all = await getCashSummary(db, { from: "2026-01-01", to: "2026-12-31" }, NOW);
    expect(all.resultCents).toBe(all.balanceCents);
    expect(all.balanceCents).toBe(76000);
    // antes de qualquer lançamento
    const early = await getCashSummary(db, { from: "2026-07-01", to: "2026-07-31" }, NOW);
    expect(early).toMatchObject({ resultCents: 0, balanceCents: 0, entryCount: 0 });
  });

  it("totais por forma de pagamento e por categoria batem com o extrato", async () => {
    okOf(await createCashEntry(db, entry({ amountCents: 1500, method: "CASH" }), NOW));
    okOf(
      await createCashEntry(
        db,
        entry({ amountCents: 700, method: "PIX", categoryId: cat("Água e luz").id }),
        NOW,
      ),
    );
    okOf(
      await createCashEntry(
        db,
        entry({ amountCents: 900, method: "PIX", categoryId: cat("Água e luz").id }),
        NOW,
      ),
    );
    okOf(
      await createCashEntry(
        db,
        entry({
          direction: "IN",
          amountCents: 400,
          method: "CASH",
          categoryId: cat("Outras entradas").id,
        }),
        NOW,
      ),
    );
    await orderPayment(5000, "CASH", "2026-10-01T15:00:00Z");
    await orderPayment(3000, "CREDIT_CARD", "2026-10-01T15:00:00Z");
    await orderPayment(2000, "DEBIT_CARD", "2026-10-01T15:00:00Z");

    const q = { from: "2026-10-01", to: "2026-10-01" };
    const s = await getCashSummary(db, q, NOW);
    expect(s.byMethod).toEqual({
      CASH: { inCents: 5400, outCents: 1500, netCents: 3900 },
      PIX: { inCents: 0, outCents: 1600, netCents: -1600 },
      DEBIT_CARD: { inCents: 2000, outCents: 0, netCents: 2000 },
      CREDIT_CARD: { inCents: 3000, outCents: 0, netCents: 3000 },
    });
    expect(s.byCategory).toEqual([
      { categoryId: null, name: "Atendimentos", direction: "IN", totalCents: 10000, count: 3 },
      {
        categoryId: cat("Outras entradas").id,
        name: "Outras entradas",
        direction: "IN",
        totalCents: 400,
        count: 1,
      },
      {
        categoryId: cat("Água e luz").id,
        name: "Água e luz",
        direction: "OUT",
        totalCents: 1600,
        count: 2,
      },
      {
        categoryId: cat("Aluguel").id,
        name: "Aluguel",
        direction: "OUT",
        totalCents: 1500,
        count: 1,
      },
    ]);
    // o extrato (paginado em páginas pequenas) soma exatamente o mesmo
    const sums = { CASH: 0, PIX: 0, DEBIT_CARD: 0, CREDIT_CARD: 0 };
    let total = 0;
    let page = 1;
    for (;;) {
      const l = await listCashEntries(db, { ...q, limit: 2, page }, NOW);
      for (const i of l.items) {
        sums[i.method] += i.direction === "IN" ? i.amountCents : -i.amountCents;
        total++;
      }
      if (page >= l.pageCount) break;
      page++;
    }
    expect(total).toBe(s.entryCount);
    for (const m of Object.keys(sums) as (keyof typeof sums)[])
      expect(sums[m]).toBe(s.byMethod[m].netCents);
    expect(s.inCents).toBe(10400);
    expect(s.outCents).toBe(3100);
  });

  it("fronteira de dia: 23h30 e 00h30 em São Paulo caem no dia certo (UTC difere)", async () => {
    // 30/09 23:30 BRT = 01/10 02:30Z ; 01/10 00:30 BRT = 01/10 03:30Z ; 01/10 23:59:59.999 BRT ; 02/10 00:00 BRT
    for (const [amountCents, at] of [
      [1, "2026-09-30T23:30:00-03:00"],
      [10, "2026-10-01T00:30:00-03:00"],
      [100, "2026-10-01T00:00:00-03:00"],
      [1000, "2026-09-30T23:59:59.999-03:00"],
    ] as const) {
      okOf(
        await createCashEntry(
          db,
          entry({ amountCents, occurredAt: at }),
          new Date("2026-10-02T12:00:00Z"),
        ),
      );
    }
    const now = new Date("2026-10-02T12:00:00Z");
    const d30 = await getCashSummary(db, { from: "2026-09-30", to: "2026-09-30" }, now);
    const d01 = await getCashSummary(db, { from: "2026-10-01", to: "2026-10-01" }, now);
    expect(d30.outCents).toBe(1001); // 23:30 e 23:59:59.999
    expect(d01.outCents).toBe(110); // 00:00 e 00:30
    expect(d30.balanceCents).toBe(-1001);
    expect(d01.balanceCents).toBe(-1111);
    const ext = await listCashEntries(db, { from: "2026-10-01", to: "2026-10-01" }, now);
    expect(ext.items.map((i) => i.amountCents)).toEqual([10, 100]); // mais recente primeiro
  });

  it("virada de mês: último lançamento de setembro e primeiro de outubro", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    okOf(
      await createCashEntry(
        db,
        entry({ amountCents: 5, occurredAt: "2026-09-30T23:30:00-03:00" }),
        now,
      ),
    );
    okOf(
      await createCashEntry(
        db,
        entry({ amountCents: 7, occurredAt: "2026-10-01T00:30:00-03:00" }),
        now,
      ),
    );
    const sep = await getCashSummary(db, { from: "2026-09-01", to: "2026-09-30" }, now);
    const oct = await getCashSummary(db, { preset: "month" }, now);
    expect(sep.outCents).toBe(5);
    expect(oct.outCents).toBe(7);
    expect(oct.period).toEqual({ preset: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(oct.openingBalanceCents).toBe(-5);
    expect(oct.balanceCents).toBe(-12);
  });

  it("presets: hoje e semana (segunda a domingo)", async () => {
    // NOW = quinta 01/10. Segunda 28/09 e domingo 04/10 estão na semana; domingo anterior 27/09 não.
    for (const [amountCents, at] of [
      [1, "2026-09-27T20:00:00-03:00"],
      [10, "2026-09-28T00:30:00-03:00"],
      [100, "2026-10-01T09:00:00-03:00"],
    ] as const) {
      okOf(await createCashEntry(db, entry({ amountCents, occurredAt: at }), NOW));
    }
    expect((await getCashSummary(db, { preset: "today" }, NOW)).outCents).toBe(100);
    expect((await getCashSummary(db, {}, NOW)).outCents).toBe(100);
    const week = await getCashSummary(db, { preset: "week" }, NOW);
    expect(week.outCents).toBe(110);
    expect(week.period.from).toBe("2026-09-28");
    // entrada inválida cai em hoje
    expect((await getCashSummary(db, { from: "xx" }, NOW)).period.from).toBe("2026-10-01");
  });
});

describe("extrato", () => {
  async function seed() {
    okOf(
      await createCashEntry(
        db,
        entry({
          amountCents: 1000,
          description: "Boleto de Outubro",
          occurredAt: "2026-10-01T08:00:00-03:00",
        }),
        NOW,
      ),
    );
    okOf(
      await createCashEntry(
        db,
        entry({
          amountCents: 2000,
          method: "CASH",
          categoryId: cat("Água e luz").id,
          occurredAt: "2026-10-01T09:00:00-03:00",
        }),
        NOW,
      ),
    );
    okOf(
      await createCashEntry(
        db,
        entry({
          direction: "IN",
          amountCents: 300,
          method: "CASH",
          categoryId: cat("Outras entradas").id,
          occurredAt: "2026-10-01T10:00:00-03:00",
        }),
        NOW,
      ),
    );
    return orderPayment(9000, "PIX", "2026-10-01T14:00:00Z", "José Antônio"); // 11:00 BRT
  }
  const q = { from: "2026-10-01", to: "2026-10-01" };

  it("ordena do mais recente ao mais antigo; pagamento de OS vem como 'Atendimento nº X'", async () => {
    const p = await seed();
    const l = await listCashEntries(db, q, NOW);
    expect(l.total).toBe(4);
    expect(l.items.map((i) => i.amountCents)).toEqual([9000, 300, 2000, 1000]);
    const first = l.items[0];
    expect(first).toMatchObject({
      kind: "ORDER_PAYMENT",
      title: `Atendimento nº ${p.serviceOrderId}`,
      orderId: p.serviceOrderId,
      customerName: "José Antônio",
      category: null,
      editable: false,
    });
    expect(l.items[3]).toMatchObject({
      title: "Aluguel",
      description: "Boleto de Outubro",
      editable: true,
    });
  });

  it("filtros: direção, categoria, ORDERS, método e combinações", async () => {
    await seed();
    const n = async (f: Record<string, unknown>) =>
      (await listCashEntries(db, { ...q, ...f }, NOW)).total;
    expect(await n({ direction: "IN" })).toBe(2);
    expect(await n({ direction: "OUT" })).toBe(2);
    expect(await n({ categoryId: cat("Aluguel").id })).toBe(1);
    expect(await n({ categoryId: "ORDERS" })).toBe(1);
    expect(await n({ method: "CASH" })).toBe(2);
    expect(await n({ method: "CASH", direction: "OUT" })).toBe(1);
    expect(await n({ method: "DEBIT_CARD" })).toBe(0);
  });

  it("busca q: descrição, categoria, cliente e número do atendimento, sem acento/caixa", async () => {
    const p = await seed();
    const ids = async (s: string) =>
      (await listCashEntries(db, { ...q, q: s }, NOW)).items.map((i) => i.amountCents);
    expect(await ids("BOLETO")).toEqual([1000]);
    expect(await ids("agua")).toEqual([2000]);
    expect(await ids("jose antonio")).toEqual([9000]);
    expect(await ids(`atendimento ${p.serviceOrderId}`)).toEqual([9000]);
    expect(await ids("nada")).toEqual([]);
  });

  it("paginação: total, páginas, página fora do intervalo e limites", async () => {
    await seed();
    const p1 = await listCashEntries(db, { ...q, limit: 3, page: 1 }, NOW);
    const p2 = await listCashEntries(db, { ...q, limit: 3, page: 2 }, NOW);
    const p3 = await listCashEntries(db, { ...q, limit: 3, page: 3 }, NOW);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([3, 1, 0]);
    expect([p1.total, p1.pageCount, p1.page, p1.limit]).toEqual([4, 2, 1, 3]);
    // com busca, a paginação também vale
    const s = await listCashEntries(db, { ...q, q: "a", limit: 1, page: 2 }, NOW);
    expect(s.items.length).toBe(1);
    expect(s.total).toBeGreaterThan(1);
    // parâmetros inválidos caem no padrão
    const bad = await listCashEntries(db, { ...q, limit: 9999, page: 0 }, NOW);
    expect([bad.page, bad.limit, bad.total]).toEqual([1, 200, 4]);
  });

  it("período vazio retorna lista vazia com pageCount 1", async () => {
    const l = await listCashEntries(db, { from: "2026-01-01", to: "2026-01-02" }, NOW);
    expect([l.items.length, l.total, l.pageCount]).toEqual([0, 0, 1]);
  });
});
