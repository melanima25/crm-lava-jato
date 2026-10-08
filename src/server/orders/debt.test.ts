// Fiado (E6): saldo devedor, /fiado e "Receber do cliente". Roda em SQLite e em Postgres (test:pg).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createService } from "@/server/catalog/domain";
import {
  createCustomer,
  createVehicle,
  getCustomerDetail,
  searchCustomers,
} from "@/server/customers/domain";
import { createTestDb } from "@/server/customers/test-db";
import { getCustomerDebt, listDebtors, receiveFromCustomer } from "./debt";
import {
  cancelOrder,
  completeOrder,
  createOrder,
  deletePayment,
  getDayCash,
  getOrderDetail,
  registerPayment,
  type ActionResult,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

let serviceId = 0;
const NOW = new Date("2026-10-01T15:00:00.000Z");
const day = (d: number) => new Date(Date.UTC(2026, 8, d, 15)); // set/2026

beforeEach(async () => {
  await db.cashEntry.deleteMany();
  await db.serviceOrderItem.deleteMany();
  await db.serviceOrder.deleteMany();
  await db.vehicle.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany();
  const s = await createService(db, { name: "Lavagem", carPriceCents: 5000 });
  if (!s.ok) throw new Error(s.error);
  serviceId = s.data.id;
});

const okOf = <T>(r: ActionResult<T>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

async function newCustomer(name: string, extra: { phone?: string; plate?: string } = {}) {
  const c = okOf(await createCustomer(db, { name, phone: extra.phone }));
  const v = okOf(await createVehicle(db, c.id, { type: "CAR", plate: extra.plate }));
  return { id: c.id, vehicleId: v.id };
}

/** OS concluída; `payments` vazio = Fiado. */
async function doneOrder(
  c: { id: number; vehicleId: number },
  priceCents: number,
  at: Date,
  payments: { method: "CASH" | "PIX" | "DEBIT_CARD" | "CREDIT_CARD"; amountCents: number }[] = [],
) {
  const o = okOf(
    await createOrder(db, {
      customerId: c.id,
      vehicleId: c.vehicleId,
      occurredAt: at,
      items: [{ serviceId, unitPriceCents: priceCents }],
    }),
  );
  return okOf(await completeOrder(db, o.id, payments, at));
}

const cashSum = async () =>
  (await db.cashEntry.aggregate({ where: { direction: "IN" }, _sum: { amountCents: true } }))._sum
    .amountCents ?? 0;

describe("receiveFromCustomer", () => {
  it("R$50 + R$80, receber R$100: 1ª quitada, 2ª com saldo R$30, dois CashEntry; depois quita o resto", async () => {
    const c = await newCustomer("Maria");
    const a = await doneOrder(c, 5000, day(1));
    const b = await doneOrder(c, 8000, day(2));
    const r = okOf(await receiveFromCustomer(db, c.id, { amountCents: 10000, method: "PIX" }, NOW));
    expect(r.distribution).toEqual([
      { orderId: a.id, amountCents: 5000, orderBalanceCents: 0 },
      { orderId: b.id, amountCents: 5000, orderBalanceCents: 3000 },
    ]);
    expect(r.receivedCents).toBe(10000);
    expect(r.balanceCents).toBe(3000);
    expect(await db.cashEntry.count()).toBe(2);
    expect((await getOrderDetail(db, a.id))?.paymentStatus).toBe("PAID");
    const bd = await getOrderDetail(db, b.id);
    expect(bd?.balanceCents).toBe(3000);
    expect(bd?.paymentStatus).toBe("PARTIAL");
    expect((await getCustomerDebt(db, c.id))?.balanceCents).toBe(3000);

    const r2 = okOf(
      await receiveFromCustomer(db, c.id, { amountCents: 3000, method: "CASH" }, NOW),
    );
    expect(r2.balanceCents).toBe(0);
    expect(r2.distribution).toEqual([{ orderId: b.id, amountCents: 3000, orderBalanceCents: 0 }]);
    expect((await listDebtors(db)).debtors).toHaveLength(0);
    expect(await cashSum()).toBe(13000);
  });

  it("quitação exata e pagamento parcial de uma OS só", async () => {
    const c = await newCustomer("Joao");
    const o = await doneOrder(c, 5000, day(1));
    const p = okOf(await receiveFromCustomer(db, c.id, { amountCents: 2000, method: "CASH" }, NOW));
    expect(p.balanceCents).toBe(3000);
    const e = okOf(
      await receiveFromCustomer(db, c.id, { amountCents: 3000, method: "DEBIT_CARD" }, NOW),
    );
    expect(e.balanceCents).toBe(0);
    expect((await getOrderDetail(db, o.id))?.paymentStatus).toBe("PAID");
  });

  it("distribui por occurredAt (não por id) e usa id como desempate", async () => {
    const c = await newCustomer("Ana");
    const novaPrimeiro = await doneOrder(c, 4000, day(10)); // id menor, data mais nova
    const antiga = await doneOrder(c, 4000, day(3)); // id maior, data mais antiga
    const empate1 = await doneOrder(c, 1000, day(20));
    const empate2 = await doneOrder(c, 1000, day(20));
    const debt = okOf({ ok: true as const, data: await getCustomerDebt(db, c.id) });
    expect(debt?.orders.map((o) => o.id)).toEqual([
      antiga.id,
      novaPrimeiro.id,
      empate1.id,
      empate2.id,
    ]);
    const r = okOf(await receiveFromCustomer(db, c.id, { amountCents: 5000, method: "PIX" }, NOW));
    expect(r.distribution.map((d) => d.orderId)).toEqual([antiga.id, novaPrimeiro.id]);
    expect(r.distribution.map((d) => d.amountCents)).toEqual([4000, 1000]);
    // desempate por id
    const r2 = okOf(await receiveFromCustomer(db, c.id, { amountCents: 4000, method: "PIX" }, NOW));
    expect(r2.distribution.map((d) => [d.orderId, d.amountCents])).toEqual([
      [novaPrimeiro.id, 3000],
      [empate1.id, 1000],
    ]);
  });

  it("rejeita valor maior que a dívida, sem gravar nada", async () => {
    const c = await newCustomer("Carlos");
    await doneOrder(c, 5000, day(1));
    const r = await receiveFromCustomer(db, c.id, { amountCents: 5001, method: "PIX" }, NOW);
    expect(r).toMatchObject({ ok: false, fieldErrors: { amountCents: expect.any(String) } });
    expect(await db.cashEntry.count()).toBe(0);
  });

  it("rejeita cliente sem dívida e cliente inexistente", async () => {
    const c = await newCustomer("Sem Divida");
    const r = await receiveFromCustomer(db, c.id, { amountCents: 100, method: "PIX" }, NOW);
    expect(r).toMatchObject({ ok: false, error: "Este cliente não tem saldo devedor" });
    expect(
      await receiveFromCustomer(db, 99999, { amountCents: 100, method: "PIX" }, NOW),
    ).toMatchObject({
      ok: false,
      error: "Cliente não encontrado",
    });
    expect(
      await receiveFromCustomer(db, "x", { amountCents: 100, method: "PIX" }, NOW),
    ).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ["FIADO", { amountCents: 100, method: "FIADO" }, "method"],
    ["método ausente", { amountCents: 100 }, "method"],
    ["valor 0", { amountCents: 0, method: "PIX" }, "amountCents"],
    ["valor negativo", { amountCents: -5, method: "PIX" }, "amountCents"],
    ["valor decimal", { amountCents: 10.5, method: "PIX" }, "amountCents"],
    ["valor texto", { amountCents: "10", method: "PIX" }, "amountCents"],
    ["data inválida", { amountCents: 100, method: "PIX", occurredAt: "ontem" }, "occurredAt"],
    [
      "data sem offset",
      { amountCents: 100, method: "PIX", occurredAt: "2026-09-01T10:00:00" },
      "occurredAt",
    ],
  ])("rejeita entrada inválida: %s", async (_n, input, field) => {
    const c = await newCustomer("Valida");
    await doneOrder(c, 5000, day(1));
    const r = await receiveFromCustomer(db, c.id, input, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors).toHaveProperty(field);
    expect(await db.cashEntry.count()).toBe(0);
  });

  it("rejeita data futura; aceita data passada e grava no caixa nessa data", async () => {
    const c = await newCustomer("Data");
    const o = await doneOrder(c, 5000, day(1));
    const fut = await receiveFromCustomer(
      db,
      c.id,
      { amountCents: 100, method: "PIX", occurredAt: "2026-10-02T15:00:00.000Z" },
      NOW,
    );
    expect(fut).toMatchObject({ ok: false, fieldErrors: { occurredAt: expect.any(String) } });
    okOf(
      await receiveFromCustomer(
        db,
        c.id,
        { amountCents: 1000, method: "PIX", occurredAt: "2026-09-20T12:00:00-03:00" },
        NOW,
      ),
    );
    const e = await db.cashEntry.findFirstOrThrow({ where: { serviceOrderId: o.id } });
    expect(e.occurredAt.toISOString()).toBe("2026-09-20T15:00:00.000Z");
    expect(e.method).toBe("PIX");
    expect((await getDayCash(db, { date: "2026-09-20" }, NOW)).totalCents).toBe(1000);
  });

  it("OS canceladas e em andamento não entram na dívida nem no recebimento", async () => {
    const c = await newCustomer("Status");
    okOf(
      await createOrder(db, {
        customerId: c.id,
        vehicleId: c.vehicleId,
        items: [{ serviceId }],
      }),
    ); // OPEN
    const canceled = await doneOrder(c, 7000, day(1));
    okOf(await cancelOrder(db, canceled.id));
    const real = await doneOrder(c, 2000, day(2));
    const d = await getCustomerDebt(db, c.id);
    expect(d?.balanceCents).toBe(2000);
    expect(d?.orders.map((o) => o.id)).toEqual([real.id]);
    expect(
      await receiveFromCustomer(db, c.id, { amountCents: 2001, method: "PIX" }, NOW),
    ).toMatchObject({ ok: false });
    expect((await listDebtors(db)).grandTotalCents).toBe(2000);
  });

  it("critério 7 e 6: Fiado e misto com saldo correto; pago na conclusão não é contado de novo", async () => {
    const c = await newCustomer("Misto");
    const fiado = await doneOrder(c, 5000, day(1));
    const misto = await doneOrder(c, 8000, day(2), [{ method: "PIX", amountCents: 3000 }]);
    const pago = await doneOrder(c, 1000, day(3), [{ method: "CASH", amountCents: 1000 }]);
    const d = await getCustomerDebt(db, c.id);
    expect(d?.orders.map((o) => [o.id, o.balanceCents, o.paymentStatus])).toEqual([
      [fiado.id, 5000, "UNPAID"],
      [misto.id, 5000, "PARTIAL"],
    ]);
    expect(d?.balanceCents).toBe(10000);
    expect(pago.paymentStatus).toBe("PAID");
    expect(await cashSum()).toBe(4000); // só o que foi pago: pendência não soma no caixa
    okOf(await receiveFromCustomer(db, c.id, { amountCents: 10000, method: "CASH" }, NOW));
    expect(await cashSum()).toBe(14000);
    expect((await getCustomerDebt(db, c.id))?.balanceCents).toBe(0);
  });

  it("estorno de pagamento restaura o saldo, sai do caixa e volta para /fiado", async () => {
    const c = await newCustomer("Estorno");
    const a = await doneOrder(c, 5000, day(1));
    const b = await doneOrder(c, 8000, day(2));
    okOf(await receiveFromCustomer(db, c.id, { amountCents: 13000, method: "PIX" }, NOW));
    expect((await listDebtors(db)).debtors).toHaveLength(0);
    const entry = await db.cashEntry.findFirstOrThrow({ where: { serviceOrderId: b.id } });
    okOf(await deletePayment(db, entry.id));
    expect((await getCustomerDebt(db, c.id))?.balanceCents).toBe(8000);
    expect(await cashSum()).toBe(5000);
    const list = await listDebtors(db);
    expect(list.debtors.map((d) => [d.customerId, d.balanceCents])).toEqual([[c.id, 8000]]);
    // recebimento parcial por OS (registerPayment) e estorno parcial
    okOf(await registerPayment(db, b.id, { amountCents: 3000, method: "CASH" }, NOW));
    const parcial = await db.cashEntry.findFirstOrThrow({
      where: { serviceOrderId: b.id, method: "CASH" },
    });
    expect((await getCustomerDebt(db, c.id))?.balanceCents).toBe(5000);
    okOf(await deletePayment(db, parcial.id));
    expect((await getCustomerDebt(db, c.id))?.balanceCents).toBe(8000);
    expect((await getOrderDetail(db, a.id))?.paymentStatus).toBe("PAID");
  });

  it("cliente inativo ainda pode pagar a dívida", async () => {
    const c = await newCustomer("Inativo");
    await doneOrder(c, 5000, day(1));
    await db.customer.update({ where: { id: c.id }, data: { active: false } });
    expect(
      okOf(await receiveFromCustomer(db, c.id, { amountCents: 5000, method: "PIX" }, NOW))
        .balanceCents,
    ).toBe(0);
  });
});

describe("consultas de fiado", () => {
  async function seed() {
    const maria = await newCustomer("Maria Conceição", { phone: "11988887777", plate: "ABC1D23" });
    const joao = await newCustomer("João", { phone: "21911112222", plate: "XYZ9K88" });
    const zeca = await newCustomer("Zeca"); // sem dívida
    await doneOrder(maria, 3000, day(5));
    await doneOrder(maria, 2000, day(8));
    await doneOrder(joao, 9000, day(2), [{ method: "PIX", amountCents: 1000 }]);
    await doneOrder(zeca, 1000, day(1), [{ method: "PIX", amountCents: 1000 }]);
    return { maria, joao, zeca };
  }

  it("lista clientes com saldo, nº de pendências, mais antigo e total geral", async () => {
    const { maria, joao, zeca } = await seed();
    const l = await listDebtors(db);
    expect(l.debtors.map((d) => d.customerId)).toEqual([joao.id, maria.id]); // padrão: mais antigo
    expect(l.debtors[0]).toMatchObject({
      name: "João",
      balanceCents: 8000,
      pendingCount: 1,
      oldestPendingAt: day(2),
    });
    expect(l.debtors[1]).toMatchObject({
      balanceCents: 5000,
      pendingCount: 2,
      oldestPendingAt: day(5),
    });
    expect(l.debtors.some((d) => d.customerId === zeca.id)).toBe(false);
    expect(l.totalCents).toBe(13000);
    expect(l.grandTotalCents).toBe(13000);
  });

  it("ordena por saldo quando pedido", async () => {
    const { maria, joao } = await seed();
    const l = await listDebtors(db, { sort: "balance" });
    expect(l.debtors.map((d) => d.customerId)).toEqual([joao.id, maria.id]);
    await doneOrder(maria, 9000, day(9));
    const l2 = await listDebtors(db, { sort: "balance" });
    expect(l2.debtors.map((d) => d.customerId)).toEqual([maria.id, joao.id]);
    const l3 = await listDebtors(db, { sort: "oldest" });
    expect(l3.debtors.map((d) => d.customerId)).toEqual([joao.id, maria.id]);
  });

  it.each([
    ["conceicao", ["Maria Conceição"]], // sem acento
    ["JOAO", ["João"]],
    ["11 98888", ["Maria Conceição"]], // telefone parcial
    ["xyz", ["João"]], // placa parcial
    ["x-y z", ["João"]],
    ["inexistente", []],
    ["%", []],
  ])("busca %s", async (q, names) => {
    await seed();
    const l = await listDebtors(db, { q });
    expect(l.debtors.map((d) => d.name)).toEqual(names);
    expect(l.grandTotalCents).toBe(13000); // total geral ignora a busca
    expect(l.totalCents).toBe(l.debtors.reduce((a, d) => a + d.balanceCents, 0));
  });

  it("getCustomerDebt: null para cliente inexistente; zero para quem não deve", async () => {
    const { zeca } = await seed();
    expect(await getCustomerDebt(db, 99999)).toBeNull();
    expect(await getCustomerDebt(db, "abc")).toBeNull();
    expect(await getCustomerDebt(db, zeca.id)).toMatchObject({
      balanceCents: 0,
      pendingCount: 0,
      oldestPendingAt: null,
      orders: [],
    });
  });

  it("debtCents na busca de clientes e no detalhe do cliente", async () => {
    const { maria, zeca } = await seed();
    const found = await searchCustomers(db, { q: "maria" });
    expect(found[0]).toMatchObject({ id: maria.id, debtCents: 5000 });
    expect((await searchCustomers(db, { q: "zeca" }))[0].debtCents).toBe(0);
    expect((await getCustomerDetail(db, maria.id))?.debtCents).toBe(5000);
    expect((await getCustomerDetail(db, zeca.id))?.debtCents).toBe(0);
  });
});
