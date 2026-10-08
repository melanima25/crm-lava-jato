// Relatórios (E10). Roda em SQLite e em Postgres (test:pg). Cenário montado à mão, valores em centavos.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/customers/test-db";
import {
  MAX_REPORT_DAYS,
  getSalesReport,
  getTopCustomers,
  getTopItems,
  resolveReportPeriod,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

// 2026-10-15 12:00 em São Paulo (quinta-feira)
const NOW = new Date("2026-10-15T15:00:00.000Z");
const MONTH = { preset: "month" as const };

type Item = { kind: "SERVICE" | "PRODUCT"; id: number; qty: number; total: number };
type Ids = { svcWash: number; svcPolish: number; prod: number; ana: number; bia: number };
let ids: Ids;
let carA: number;
let motoB: number;

beforeEach(async () => {
  await db.cashEntry.deleteMany();
  await db.serviceOrderItem.deleteMany();
  await db.serviceOrder.deleteMany();
  await db.vehicle.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany();
  await db.product.deleteMany();
  const wash = await db.service.create({ data: { name: "Lavagem", searchName: "lavagem" } });
  const polish = await db.service.create({ data: { name: "Polimento", searchName: "polimento" } });
  const prod = await db.product.create({ data: { name: "Óleo", searchName: "oleo" } });
  const ana = await db.customer.create({ data: { name: "Ana", searchName: "ana" } });
  const bia = await db.customer.create({ data: { name: "Bia", searchName: "bia" } });
  carA = (await db.vehicle.create({ data: { customerId: ana.id, type: "CAR" } })).id;
  motoB = (await db.vehicle.create({ data: { customerId: bia.id, type: "MOTORCYCLE" } })).id;
  ids = { svcWash: wash.id, svcPolish: polish.id, prod: prod.id, ana: ana.id, bia: bia.id };
});

async function order(o: {
  customer: number;
  vehicle?: number | null;
  status?: "OPEN" | "DONE" | "CANCELED";
  at: string;
  total: number;
  paid?: number;
  discount?: number;
  items?: Item[];
}) {
  const so = await db.serviceOrder.create({
    data: {
      customerId: o.customer,
      vehicleId: o.vehicle ?? null,
      status: o.status ?? "DONE",
      occurredAt: new Date(o.at),
      totalCents: o.total,
      paidCents: o.paid ?? 0,
      discountCents: o.discount ?? 0,
      items: {
        create: (o.items ?? []).map((i) => ({
          kind: i.kind,
          serviceId: i.kind === "SERVICE" ? i.id : null,
          productId: i.kind === "PRODUCT" ? i.id : null,
          description: i.kind === "SERVICE" ? "descrição antiga" : "óleo antigo",
          quantity: i.qty,
          unitPriceCents: Math.round(i.total / i.qty),
          totalCents: i.total,
        })),
      },
    },
  });
  return so.id;
}

async function pay(orderId: number, amount: number, at: string, method: "PIX" | "CASH" = "PIX") {
  await db.cashEntry.create({
    data: {
      direction: "IN",
      amountCents: amount,
      method,
      serviceOrderId: orderId,
      occurredAt: new Date(at),
    },
  });
}

/** Cenário do qa: 3 OS no mês, 1 cancelada, 1 aberta, 1 recebimento hoje de fiado do mês anterior. */
async function qaScenario() {
  const wash = (total: number): Item => ({ kind: "SERVICE", id: ids.svcWash, qty: 1, total });
  const a = await order({
    customer: ids.ana,
    vehicle: carA,
    at: "2026-10-03T13:00:00Z",
    total: 10000,
    paid: 10000,
    items: [wash(10000)],
  });
  await pay(a, 10000, "2026-10-03T13:00:00Z");
  await order({
    customer: ids.bia,
    vehicle: motoB,
    at: "2026-10-05T13:00:00Z",
    total: 8000,
    paid: 0,
    items: [wash(8000)],
  });
  const c = await order({
    customer: ids.ana,
    vehicle: carA,
    at: "2026-10-10T13:00:00Z",
    total: 5000,
    paid: 2000,
    discount: 500,
    items: [
      { kind: "SERVICE", id: ids.svcPolish, qty: 1, total: 4000 },
      { kind: "PRODUCT", id: ids.prod, qty: 2, total: 1500 },
    ],
  });
  await pay(c, 2000, "2026-10-10T13:00:00Z", "CASH");
  // cancelada e aberta: fora de tudo
  await order({
    customer: ids.ana,
    vehicle: carA,
    status: "CANCELED",
    at: "2026-10-06T13:00:00Z",
    total: 7000,
    items: [wash(7000), { kind: "PRODUCT", id: ids.prod, qty: 1, total: 900 }],
  });
  await order({
    customer: ids.bia,
    vehicle: motoB,
    status: "OPEN",
    at: "2026-10-07T13:00:00Z",
    total: 3000,
    items: [wash(3000)],
  });
  // fiado de setembro (R$ 40) quitado hoje
  const old = await order({
    customer: ids.bia,
    vehicle: motoB,
    at: "2026-09-20T13:00:00Z",
    total: 4000,
    paid: 4000,
    items: [wash(4000)],
  });
  await pay(old, 4000, "2026-10-15T14:00:00Z");
}

describe("getSalesReport", () => {
  it("cenário do qa: Vendido 230, Recebido 160 (40 de fiado anterior), fiado 110, 3 atendimentos", async () => {
    await qaScenario();
    const r = await getSalesReport(db, MONTH, NOW);
    expect(r.soldCents).toBe(23000);
    expect(r.receivedCents).toBe(16000);
    expect(r.receivedFromPriorCents).toBe(4000);
    expect(r.pendingCents).toBe(11000);
    expect(r.ordersCount).toBe(3);
    expect(r.averageTicketCents).toBe(7667);
    expect(r.discountCents).toBe(500);
    expect(r.granularity).toBe("day");
    expect(r.period).toMatchObject({ fromYmd: "2026-10-01", toYmd: "2026-10-31", days: 31 });
    expect(r.rows).toEqual([
      { key: "2026-10-03", ordersCount: 1, soldCents: 10000, receivedCents: 10000 },
      { key: "2026-10-05", ordersCount: 1, soldCents: 8000, receivedCents: 0 },
      { key: "2026-10-10", ordersCount: 1, soldCents: 5000, receivedCents: 2000 },
      { key: "2026-10-15", ordersCount: 0, soldCents: 0, receivedCents: 4000 },
    ]);
    // soma das linhas = totais
    expect(r.rows.reduce((s, x) => s + x.receivedCents, 0)).toBe(r.receivedCents);
  });

  it("mês passado: o fiado de setembro é Vendido de setembro; quitar hoje não muda o Vendido", async () => {
    await qaScenario();
    const r = await getSalesReport(db, { preset: "lastMonth" }, NOW);
    expect(r.period).toMatchObject({
      preset: "lastMonth",
      fromYmd: "2026-09-01",
      toYmd: "2026-09-30",
    });
    expect(r.soldCents).toBe(4000);
    expect(r.ordersCount).toBe(1);
    expect(r.receivedCents).toBe(0);
    expect(r.pendingCents).toBe(0);
  });

  it("receber um fiado hoje aumenta o Recebido de hoje e reduz o fiado do período da OS", async () => {
    await qaScenario();
    const fiado = await db.serviceOrder.findFirstOrThrow({ where: { totalCents: 8000 } });
    const before = await getSalesReport(db, { preset: "today" }, NOW);
    await pay(fiado.id, 3000, "2026-10-15T16:00:00Z");
    await db.serviceOrder.update({ where: { id: fiado.id }, data: { paidCents: 3000 } });
    const today = await getSalesReport(db, { preset: "today" }, NOW);
    expect(today.receivedCents).toBe(before.receivedCents + 3000);
    expect(today.soldCents).toBe(before.soldCents);
    const month = await getSalesReport(db, MONTH, NOW);
    expect(month.soldCents).toBe(23000);
    expect(month.pendingCents).toBe(8000);
    expect(month.receivedCents).toBe(19000);
  });

  it("sem atendimentos: ticket médio null e zeros", async () => {
    const r = await getSalesReport(db, MONTH, NOW);
    expect(r).toMatchObject({
      soldCents: 0,
      receivedCents: 0,
      pendingCents: 0,
      ordersCount: 0,
      averageTicketCents: null,
      rows: [],
    });
  });

  it("23h30 local conta no dia local (não no dia UTC); 00h30 local, no dia seguinte", async () => {
    // 31/10 23:30 SP = 01/11 02:30 UTC; 01/11 00:30 SP = 01/11 03:30 UTC
    await order({ customer: ids.ana, at: "2026-11-01T02:30:00Z", total: 1000 });
    await order({ customer: ids.ana, at: "2026-11-01T03:30:00Z", total: 2000 });
    const oct = await getSalesReport(db, MONTH, NOW);
    expect(oct.soldCents).toBe(1000);
    expect(oct.rows).toEqual([
      { key: "2026-10-31", ordersCount: 1, soldCents: 1000, receivedCents: 0 },
    ]);
    const nov = await getSalesReport(db, { from: "2026-11-01", to: "2026-11-01" }, NOW);
    expect(nov.soldCents).toBe(2000);
    expect(nov.rows.map((x) => x.key)).toEqual(["2026-11-01"]);
  });

  it("pagamento às 23h30 local cai no dia local do Recebido", async () => {
    const o = await order({ customer: ids.ana, at: "2026-10-02T13:00:00Z", total: 500, paid: 500 });
    await pay(o, 500, "2026-10-04T02:30:00Z"); // 03/10 23:30 SP
    const r = await getSalesReport(db, MONTH, NOW);
    expect(r.rows.find((x) => x.key === "2026-10-03")?.receivedCents).toBe(500);
    expect(r.rows.find((x) => x.key === "2026-10-04")).toBeUndefined();
  });

  it("OS cancelada depois de concluída não conta em nada", async () => {
    // cancelamento só é permitido sem pagamentos: status CANCELED, sem lançamentos
    await order({
      customer: ids.ana,
      status: "CANCELED",
      at: "2026-10-03T13:00:00Z",
      total: 9900,
      paid: 0,
    });
    const r = await getSalesReport(db, MONTH, NOW);
    expect(r.soldCents).toBe(0);
    expect(r.ordersCount).toBe(0);
    expect(r.pendingCents).toBe(0);
  });

  it("período acima de 62 dias agrupa por mês", async () => {
    await order({ customer: ids.ana, at: "2026-08-10T13:00:00Z", total: 1000 });
    await order({ customer: ids.ana, at: "2026-08-20T13:00:00Z", total: 500 });
    await order({ customer: ids.ana, at: "2026-10-02T13:00:00Z", total: 700 });
    const r = await getSalesReport(db, { from: "2026-07-01", to: "2026-10-31" }, NOW);
    expect(r.granularity).toBe("month");
    expect(r.rows).toEqual([
      { key: "2026-08", ordersCount: 2, soldCents: 1500, receivedCents: 0 },
      { key: "2026-10", ordersCount: 1, soldCents: 700, receivedCents: 0 },
    ]);
  });
});

describe("resolveReportPeriod", () => {
  it("personalizado acima de 366 dias é encurtado mantendo o fim", () => {
    const r = resolveReportPeriod({ from: "2020-01-01", to: "2026-10-15" }, NOW);
    expect(r.truncated).toBe(true);
    expect(r.days).toBe(MAX_REPORT_DAYS);
    expect(r.toYmd).toBe("2026-10-15");
    expect(r.fromYmd).toBe("2025-10-15");
  });
  it("exatamente 366 dias não é encurtado", () => {
    const r = resolveReportPeriod({ from: "2025-10-15", to: "2026-10-15" }, NOW);
    expect(r).toMatchObject({ truncated: false, days: 366, fromYmd: "2025-10-15" });
  });
});

describe("getTopItems", () => {
  it("serviços: bruto sem ratear desconto, nome atual, quebra carro/moto, exclui cancelada/aberta", async () => {
    await qaScenario();
    await db.service.update({ where: { id: ids.svcWash }, data: { name: "Lavagem completa" } });
    const r = await getTopItems(db, MONTH, "SERVICE", "quantity", NOW);
    expect(r.discountCents).toBe(500);
    expect(r.rows).toEqual([
      {
        id: ids.svcWash,
        name: "Lavagem completa",
        quantity: 2,
        ordersCount: 2,
        grossCents: 18000,
        byVehicle: {
          car: { quantity: 1, grossCents: 10000 },
          motorcycle: { quantity: 1, grossCents: 8000 },
        },
      },
      {
        id: ids.svcPolish,
        name: "Polimento",
        quantity: 1,
        ordersCount: 1,
        grossCents: 4000,
        byVehicle: {
          car: { quantity: 1, grossCents: 4000 },
          motorcycle: { quantity: 0, grossCents: 0 },
        },
      },
    ]);
  });

  it("ordenação por valor", async () => {
    await order({
      customer: ids.ana,
      vehicle: carA,
      at: "2026-10-03T13:00:00Z",
      total: 6000,
      items: [
        { kind: "SERVICE", id: ids.svcWash, qty: 3, total: 3000 },
        { kind: "SERVICE", id: ids.svcPolish, qty: 1, total: 3000 },
      ],
    });
    const q = await getTopItems(db, MONTH, "SERVICE", "quantity", NOW);
    expect(q.rows.map((x) => x.name)).toEqual(["Lavagem", "Polimento"]);
    await order({
      customer: ids.ana,
      vehicle: carA,
      at: "2026-10-04T13:00:00Z",
      total: 5000,
      items: [{ kind: "SERVICE", id: ids.svcPolish, qty: 1, total: 5000 }],
    });
    const v = await getTopItems(db, MONTH, "SERVICE", "value", NOW);
    expect(v.rows.map((x) => x.name)).toEqual(["Polimento", "Lavagem"]);
  });

  it("produtos: sem quebra por veículo; cancelada fora", async () => {
    await qaScenario();
    const r = await getTopItems(db, MONTH, "PRODUCT", "quantity", NOW);
    expect(r.rows).toEqual([
      {
        id: ids.prod,
        name: "Óleo",
        quantity: 2,
        ordersCount: 1,
        grossCents: 1500,
        byVehicle: null,
      },
    ]);
  });
});

describe("getTopCustomers", () => {
  it("visitas, valor, última visita e saldo devedor atual; cancelada/aberta fora", async () => {
    await qaScenario();
    const r = await getTopCustomers(db, MONTH, NOW);
    expect(r.rows).toEqual([
      {
        customerId: ids.ana,
        name: "Ana",
        active: true,
        visits: 2,
        totalCents: 15000,
        lastVisitAt: new Date("2026-10-10T13:00:00Z"),
        debtCents: 3000,
      },
      {
        customerId: ids.bia,
        name: "Bia",
        active: true,
        visits: 1,
        totalCents: 8000,
        lastVisitAt: new Date("2026-10-05T13:00:00Z"),
        debtCents: 8000,
      },
    ]);
  });

  it("limita a 20, desempata por valor e inclui inativos", async () => {
    await db.customer.update({ where: { id: ids.bia }, data: { active: false } });
    await order({ customer: ids.ana, at: "2026-10-03T13:00:00Z", total: 1000 });
    await order({ customer: ids.bia, at: "2026-10-03T14:00:00Z", total: 2000 });
    for (let i = 0; i < 20; i++) {
      const c = await db.customer.create({ data: { name: `C${i}`, searchName: `c${i}` } });
      await order({ customer: c.id, at: "2026-10-04T13:00:00Z", total: 100 });
      await order({ customer: c.id, at: "2026-10-05T13:00:00Z", total: 100 });
    }
    const r = await getTopCustomers(db, MONTH, NOW);
    expect(r.rows).toHaveLength(20);
    expect(r.rows.every((x) => x.visits === 2)).toBe(true);

    await db.serviceOrder.deleteMany({ where: { customerId: { notIn: [ids.ana, ids.bia] } } });
    const small = await getTopCustomers(db, MONTH, NOW);
    expect(small.rows.map((x) => [x.name, x.active])).toEqual([
      ["Bia", false],
      ["Ana", true],
    ]);
  });
});
