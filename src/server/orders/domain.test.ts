import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  canHardDelete,
  createProduct,
  createService,
  deleteService,
  MSG as CAT,
} from "@/server/catalog/domain";
import { DEFAULT_CASH_CATEGORIES, ensureDefaultCashCategories } from "@/server/cash/categories";
import {
  createCustomer,
  deleteCustomer,
  MSG as MSGC,
  createVehicle,
  setCustomerActive,
  setVehicleActive,
} from "@/server/customers/domain";
import { createTestDb } from "@/server/customers/test-db";
import {
  addServiceItem,
  cancelOrder,
  completeOrder,
  createOrder,
  deleteOrder,
  deletePayment,
  getDayCash,
  getOrderDetail,
  MSG,
  listOrders,
  listServicesForVehicleType,
  recalcOrder,
  registerPayment,
  removeServiceItem,
  updateOrder,
  updateServiceItem,
  type ActionResult,
  type OrderDetail,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

let customerId = 0;
let carId = 0;
let motoId = 0;
let lavagem = 0; // carro 5000 / moto 3000
let polimento = 0; // só carro 8000
let capa = 0; // só moto 2000

beforeEach(async () => {
  await db.cashEntry.deleteMany();
  await db.serviceOrderItem.deleteMany();
  await db.serviceOrder.deleteMany();
  await db.vehicle.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany();
  await db.product.deleteMany();
  const c = await createCustomer(db, { name: "Maria Silva", phone: "11987654321" });
  if (!c.ok) throw new Error(c.error);
  customerId = c.data.id;
  const car = await createVehicle(db, customerId, { type: "CAR", plate: "ABC1D23" });
  const moto = await createVehicle(db, customerId, { type: "MOTORCYCLE", plate: "XYZ9K88" });
  if (!car.ok || !moto.ok) throw new Error("veículo");
  carId = car.data.id;
  motoId = moto.data.id;
  const mk = async (name: string, carPrice: number | null, motoPrice: number | null) => {
    const r = await createService(db, {
      name,
      carPriceCents: carPrice,
      motorcyclePriceCents: motoPrice,
    });
    if (!r.ok) throw new Error(r.error);
    return r.data.id;
  };
  lavagem = await mk("Lavagem", 5000, 3000);
  polimento = await mk("Polimento", 8000, null);
  capa = await mk("Capa", null, 2000);
});

function ok(r: ActionResult<OrderDetail>): OrderDetail {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** OS de carro com um item de serviço por preço informado; total = soma dos preços - desconto. */
async function order(prices: number[] = [8000], extra: Record<string, unknown> = {}) {
  return ok(
    await createOrder(db, {
      customerId,
      vehicleId: carId,
      items: prices.map((unitPriceCents) => ({ serviceId: lavagem, unitPriceCents })),
      ...extra,
    }),
  );
}

describe("criar OS e preço por tipo de veículo", () => {
  it("sugere preço de carro e de moto e grava snapshot", async () => {
    const a = ok(
      await createOrder(db, { customerId, vehicleId: carId, items: [{ serviceId: lavagem }] }),
    );
    expect(a.items[0]).toMatchObject({
      unitPriceCents: 5000,
      quantity: 1,
      totalCents: 5000,
      description: "Lavagem",
    });
    expect(a.totalCents).toBe(5000);
    const b = ok(
      await createOrder(db, { customerId, vehicleId: motoId, items: [{ serviceId: lavagem }] }),
    );
    expect(b.items[0].unitPriceCents).toBe(3000);
    // mudar o catálogo não altera o item existente
    await db.service.update({ where: { id: lavagem }, data: { carPriceCents: 9999 } });
    expect((await getOrderDetail(db, a.id))!.items[0].unitPriceCents).toBe(5000);
  });

  it("preço é editável (inclusive R$ 0) e quantidade multiplica", async () => {
    const a = ok(
      await createOrder(db, {
        customerId,
        vehicleId: carId,
        items: [{ serviceId: lavagem, quantity: 2, unitPriceCents: 4500 }],
      }),
    );
    expect(a.totalCents).toBe(9000);
    const b = ok(await addServiceItem(db, a.id, { serviceId: lavagem, unitPriceCents: 0 }));
    expect(b.totalCents).toBe(9000);
  });

  it("serviço não oferecido para o tipo é rejeitado", async () => {
    const r = await createOrder(db, {
      customerId,
      vehicleId: motoId,
      items: [{ serviceId: polimento }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.["items.0.serviceId"]).toMatch(/não é oferecido para moto/);
    expect(await db.serviceOrder.count()).toBe(0); // rollback: sem OS órfã
    const o = ok(await createOrder(db, { customerId, vehicleId: carId }));
    const r2 = await addServiceItem(db, o.id, { serviceId: capa });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors?.serviceId).toMatch(/não é oferecido para carro/);
  });

  it("serviço inativo, inexistente, quantidade e preço inválidos", async () => {
    await db.service.update({ where: { id: lavagem }, data: { active: false } });
    const o = ok(await createOrder(db, { customerId, vehicleId: carId }));
    expect((await addServiceItem(db, o.id, { serviceId: lavagem })).ok).toBe(false);
    expect((await addServiceItem(db, o.id, { serviceId: 99999 })).ok).toBe(false);
    expect((await addServiceItem(db, o.id, { serviceId: polimento, quantity: 0 })).ok).toBe(false);
    expect((await addServiceItem(db, o.id, { serviceId: polimento, quantity: 1.5 })).ok).toBe(
      false,
    );
    expect((await addServiceItem(db, o.id, { serviceId: polimento, unitPriceCents: -1 })).ok).toBe(
      false,
    );
    expect(
      (await addServiceItem(db, o.id, { serviceId: polimento, unitPriceCents: 10.5 })).ok,
    ).toBe(false);
  });

  it("veículo obrigatório com serviço; deve ser do cliente e ativo; cliente ativo", async () => {
    const r = await createOrder(db, { customerId, items: [{ serviceId: lavagem }] });
    expect(!r.ok && r.fieldErrors?.vehicleId).toBeTruthy();
    const other = await createCustomer(db, { name: "Outro" });
    if (!other.ok) throw new Error("x");
    const r2 = await createOrder(db, { customerId: other.data.id, vehicleId: carId });
    expect(!r2.ok && r2.fieldErrors?.vehicleId).toMatch(/não pertence/);
    await setVehicleActive(db, carId, false);
    expect((await createOrder(db, { customerId, vehicleId: carId })).ok).toBe(false);
    await setCustomerActive(db, customerId, false);
    expect((await createOrder(db, { customerId })).ok).toBe(false);
    expect((await createOrder(db, { customerId: 9999 })).ok).toBe(false);
  });

  it("OS sem serviços pode não ter veículo; adicionar serviço exige veículo", async () => {
    const o = ok(await createOrder(db, { customerId }));
    expect(o.vehicle).toBeNull();
    expect((await addServiceItem(db, o.id, { serviceId: lavagem })).ok).toBe(false);
    ok(await updateOrder(db, o.id, { vehicleId: carId }));
    ok(await addServiceItem(db, o.id, { serviceId: lavagem }));
  });
});

describe("desconto e recalcOrder", () => {
  it("total = soma - desconto; desconto <= subtotal", async () => {
    const o = await order([5000, 3000], { discountCents: 1000 });
    expect(o).toMatchObject({ subtotalCents: 8000, discountCents: 1000, totalCents: 7000 });
    const r = await updateOrder(db, o.id, { discountCents: 8001 });
    expect(!r.ok && r.fieldErrors?.discountCents).toBeTruthy();
    expect((await getOrderDetail(db, o.id))!.totalCents).toBe(7000); // rollback
    expect(ok(await updateOrder(db, o.id, { discountCents: 8000 })).totalCents).toBe(0);
    expect((await createOrder(db, { customerId, discountCents: 1 })).ok).toBe(false);
    expect((await updateOrder(db, o.id, { discountCents: -5 })).ok).toBe(false);
  });

  it("remover item que deixaria desconto maior que o subtotal é rejeitado", async () => {
    const o = await order([5000, 3000], { discountCents: 6000 });
    const r = await removeServiceItem(db, o.items[0].id);
    expect(r.ok).toBe(false);
    expect((await getOrderDetail(db, o.id))!.items).toHaveLength(2);
  });

  it("recalcOrder reflete itens e pagamentos e corrige caches divergentes", async () => {
    const o = await order([5000, 3000]);
    ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 2000 }]));
    await db.serviceOrder.update({ where: { id: o.id }, data: { totalCents: 1, paidCents: 999 } });
    const r = await db.$transaction((tx) => recalcOrder(tx, o.id));
    expect(r).toEqual({ subtotalCents: 8000, totalCents: 8000, paidCents: 2000 });
    const row = await db.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect([row.totalCents, row.paidCents]).toEqual([8000, 2000]);
  });

  it("editar/remover item atualiza o total", async () => {
    const o = await order([5000, 3000]);
    const u = ok(await updateServiceItem(db, o.items[0].id, { quantity: 3, unitPriceCents: 1000 }));
    expect(u.totalCents).toBe(6000);
    expect(ok(await removeServiceItem(db, o.items[1].id)).totalCents).toBe(3000);
    expect((await updateServiceItem(db, o.items[0].id, {})).ok).toBe(false);
    expect((await updateServiceItem(db, o.items[0].id, { quantity: 0 })).ok).toBe(false);
  });
});

describe("concluir: à vista, Fiado e misto", () => {
  it("Fiado (lista vazia): conclui sem CashEntry, Não pago", async () => {
    const o = await order([8000]);
    const d = ok(await completeOrder(db, o.id, []));
    expect(d).toMatchObject({
      status: "DONE",
      paidCents: 0,
      balanceCents: 8000,
      paymentStatus: "UNPAID",
    });
    expect(d.completedAt).toBeInstanceOf(Date);
    expect(await db.cashEntry.count()).toBe(0);
  });

  it("à vista em uma forma: Pago e entra no caixa", async () => {
    const o = await order([5000, 3000]);
    const d = ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 8000 }]));
    expect(d).toMatchObject({ paidCents: 8000, balanceCents: 0, paymentStatus: "PAID" });
    expect(d.payments).toHaveLength(1);
  });

  it("misto R$80: R$30 Pix -> Parcial, saldo R$50", async () => {
    const o = await order([8000]);
    const d = ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 3000 }]));
    expect(d).toMatchObject({ paymentStatus: "PARTIAL", paidCents: 3000, balanceCents: 5000 });
    expect(await db.cashEntry.count()).toBe(1);
  });

  it("misto R$80: R$50 dinheiro + R$30 Pix -> Pago, dois lançamentos", async () => {
    const o = await order([8000]);
    const d = ok(
      await completeOrder(db, o.id, [
        { method: "CASH", amountCents: 5000 },
        { method: "PIX", amountCents: 3000 },
      ]),
    );
    expect(d).toMatchObject({ paymentStatus: "PAID", paidCents: 8000 });
    expect(d.payments.map((p) => p.method)).toEqual(["CASH", "PIX"]);
  });

  it("soma acima do total é rejeitada e nada é gravado (status continua OPEN)", async () => {
    const o = await order([8000]);
    const r = await completeOrder(db, o.id, [
      { method: "CASH", amountCents: 5000 },
      { method: "PIX", amountCents: 3001 },
    ]);
    expect(!r.ok && r.fieldErrors?.payments).toBeTruthy();
    expect((await getOrderDetail(db, o.id))!.status).toBe("OPEN");
    expect(await db.cashEntry.count()).toBe(0);
  });

  it("linha inválida: valor 0, negativo, forma inexistente (Fiado não é forma)", async () => {
    const o = await order([8000]);
    const r = await completeOrder(db, o.id, [{ method: "PIX", amountCents: 0 }]);
    expect(!r.ok && r.fieldErrors?.["payments.0.amountCents"]).toBeTruthy();
    expect((await completeOrder(db, o.id, [{ method: "PIX", amountCents: -1 }])).ok).toBe(false);
    const f = await completeOrder(db, o.id, [{ method: "FIADO", amountCents: 100 }]);
    expect(!f.ok && f.fieldErrors?.["payments.0.method"]).toBeTruthy();
    expect((await getOrderDetail(db, o.id))!.status).toBe("OPEN");
  });

  it("exige ao menos 1 item", async () => {
    const o = ok(await createOrder(db, { customerId }));
    const r = await completeOrder(db, o.id, []);
    expect(!r.ok && r.error).toMatch(/ao menos um item/);
  });

  it("OS de total R$ 0: conclui como Pago; pagamento é rejeitado", async () => {
    const o = await order([5000], { discountCents: 5000 });
    expect((await completeOrder(db, o.id, [{ method: "CASH", amountCents: 1 }])).ok).toBe(false);
    const d = ok(await completeOrder(db, o.id, []));
    expect(d).toMatchObject({ totalCents: 0, paymentStatus: "PAID" });
  });

  it("pagamento entra no caixa com a data da conclusão", async () => {
    const o = await order([8000]);
    const now = new Date("2026-09-10T15:00:00Z");
    const d = ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 8000 }], now));
    expect(d.payments[0].occurredAt).toEqual(now);
    expect(d.completedAt).toEqual(now);
  });

  it("concorrência: concluir duas vezes grava pagamento uma única vez", async () => {
    const o = await order([8000]);
    const pay = [{ method: "PIX", amountCents: 8000 }];
    const rs = await Promise.allSettled([
      completeOrder(db, o.id, pay),
      completeOrder(db, o.id, pay),
    ]);
    const oks = rs.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    expect(oks).toBe(1);
    expect(await db.cashEntry.count()).toBe(1);
    expect((await getOrderDetail(db, o.id))!.paidCents).toBe(8000);
  });
});

describe("transições", () => {
  it("DONE não conclui de novo; CANCELED não muda; sem reabrir", async () => {
    const o = await order([8000]);
    ok(await completeOrder(db, o.id, []));
    expect((await completeOrder(db, o.id, [])).ok).toBe(false);
    const c = await order([8000]);
    ok(await cancelOrder(db, c.id));
    expect((await completeOrder(db, c.id, [])).ok).toBe(false);
    expect((await cancelOrder(db, c.id)).ok).toBe(false);
    expect((await addServiceItem(db, c.id, { serviceId: lavagem })).ok).toBe(false);
    expect((await updateOrder(db, c.id, { notes: "x" })).ok).toBe(false);
    expect((await removeServiceItem(db, c.items[0].id)).ok).toBe(false);
  });

  it("registrar pagamento exige OS concluída", async () => {
    const o = await order([8000]);
    expect((await registerPayment(db, o.id, { method: "PIX", amountCents: 100 })).ok).toBe(false);
    ok(await cancelOrder(db, o.id));
    expect((await registerPayment(db, o.id, { method: "PIX", amountCents: 100 })).ok).toBe(false);
  });

  it("veículo só troca em OPEN; desconto e observação em DONE", async () => {
    const o = await order([8000]);
    ok(await completeOrder(db, o.id, []));
    expect((await updateOrder(db, o.id, { vehicleId: motoId })).ok).toBe(false);
    const d = ok(await updateOrder(db, o.id, { discountCents: 1000, notes: "  obs  " }));
    expect(d).toMatchObject({ totalCents: 7000, notes: "obs" });
  });

  it("trocar veículo para tipo em que o serviço não é oferecido é rejeitado", async () => {
    const o = ok(
      await createOrder(db, { customerId, vehicleId: carId, items: [{ serviceId: polimento }] }),
    );
    expect((await updateOrder(db, o.id, { vehicleId: motoId })).ok).toBe(false);
    expect((await updateOrder(db, o.id, { vehicleId: null })).ok).toBe(false);
    const o2 = await order([5000]);
    expect(ok(await updateOrder(db, o2.id, { vehicleId: motoId })).vehicle?.id).toBe(motoId);
  });

  it("concluída não pode ficar sem itens, nem total abaixo do pago", async () => {
    const o = await order([8000]);
    ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 5000 }]));
    expect((await removeServiceItem(db, o.items[0].id)).ok).toBe(false);
    const r = await updateOrder(db, o.id, { discountCents: 4000 });
    expect(!r.ok && r.error).toMatch(/menor que o valor já pago/);
    expect((await updateServiceItem(db, o.items[0].id, { unitPriceCents: 4000 })).ok).toBe(false);
    const u = ok(await updateServiceItem(db, o.items[0].id, { unitPriceCents: 10000 }));
    expect(u.balanceCents).toBe(5000);
  });
});

describe("pagamentos posteriores e estorno", () => {
  it("recebe em parcelas até quitar; acima do saldo rejeitado", async () => {
    const o = await order([8000]);
    ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 3000 }]));
    const big = await registerPayment(db, o.id, { method: "CASH", amountCents: 5001 });
    expect(!big.ok && big.fieldErrors?.amountCents).toBeTruthy();
    const a = ok(await registerPayment(db, o.id, { method: "CASH", amountCents: 2000 }));
    expect(a).toMatchObject({ paidCents: 5000, paymentStatus: "PARTIAL" });
    const b = ok(await registerPayment(db, o.id, { method: "DEBIT_CARD", amountCents: 3000 }));
    expect(b).toMatchObject({ paidCents: 8000, balanceCents: 0, paymentStatus: "PAID" });
    const again = await registerPayment(db, o.id, { method: "CASH", amountCents: 1 });
    expect(!again.ok && again.error).toMatch(/quitado/);
    expect((await registerPayment(db, o.id, { method: "FIADO", amountCents: 1 })).ok).toBe(false);
    expect((await registerPayment(db, o.id, { method: "CASH", amountCents: 0 })).ok).toBe(false);
  });

  it("data futura rejeitada", async () => {
    const o = await order([8000]);
    ok(await completeOrder(db, o.id, []));
    const now = new Date("2026-09-10T12:00:00Z");
    const r = await registerPayment(
      db,
      o.id,
      { method: "PIX", amountCents: 100, occurredAt: new Date("2026-09-11T12:00:00Z") },
      now,
    );
    expect(!r.ok && r.fieldErrors?.occurredAt).toBeTruthy();
  });

  it("estorno volta o saldo e remove do caixa; id inexistente rejeitado", async () => {
    const o = await order([8000]);
    const d = ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 8000 }]));
    const e = ok(await deletePayment(db, d.payments[0].id));
    expect(e).toMatchObject({
      paidCents: 0,
      balanceCents: 8000,
      paymentStatus: "UNPAID",
      status: "DONE",
    });
    expect(await db.cashEntry.count()).toBe(0);
    expect((await deletePayment(db, d.payments[0].id)).ok).toBe(false);
  });

  it("não estorna lançamento que não é pagamento de OS", async () => {
    await ensureDefaultCashCategories(db);
    const cat = await db.cashCategory.findFirstOrThrow({ where: { direction: "OUT" } });
    const e = await db.cashEntry.create({
      data: {
        direction: "OUT",
        amountCents: 100,
        method: "CASH",
        categoryId: cat.id,
        occurredAt: new Date(),
      },
    });
    const r = await deletePayment(db, e.id);
    expect(!r.ok && r.error).toMatch(/não é um pagamento/);
    expect(await db.cashEntry.count()).toBe(1);
  });
});

describe("cancelar", () => {
  it("OPEN ok; DONE sem pagamento ok; DONE com pagamento bloqueado até estornar", async () => {
    const a = await order([8000]);
    expect(ok(await cancelOrder(db, a.id)).status).toBe("CANCELED");
    const b = await order([8000]);
    ok(await completeOrder(db, b.id, []));
    expect(ok(await cancelOrder(db, b.id)).status).toBe("CANCELED");
    const c = await order([8000]);
    const d = ok(await completeOrder(db, c.id, [{ method: "PIX", amountCents: 1000 }]));
    const r = await cancelOrder(db, c.id);
    expect(!r.ok && r.error).toMatch(/Estorne/);
    expect((await getOrderDetail(db, c.id))!.status).toBe("DONE"); // rollback do status
    ok(await deletePayment(db, d.payments[0].id));
    expect(ok(await cancelOrder(db, c.id)).status).toBe("CANCELED");
  });

  it("cancelada fica sem situação de pagamento", async () => {
    const a = await order([8000]);
    ok(await cancelOrder(db, a.id));
    expect((await getDayCash(db)).totalCents).toBe(0);
    const l = await listOrders(db, { status: "CANCELED" });
    expect(l.map((o) => o.paymentStatus)).toEqual([null]);
  });
});

describe("estoque inalterado", () => {
  it("nenhuma operação de OS altera Product.stockQuantity", async () => {
    const p = await createProduct(db, { name: "Óleo", salePriceCents: 3000 });
    if (!p.ok) throw new Error("p");
    await db.product.update({ where: { id: p.data.id }, data: { stockQuantity: 7 } });
    const o = await order([5000, 3000]);
    ok(await completeOrder(db, o.id, [{ method: "PIX", amountCents: 1000 }]));
    ok(await registerPayment(db, o.id, { method: "CASH", amountCents: 500 }));
    const o2 = await order([5000]);
    ok(await cancelOrder(db, o2.id));
    const after = await db.product.findUniqueOrThrow({ where: { id: p.data.id } });
    expect(after.stockQuantity).toBe(7);
  });
});

describe("listas, caixa do dia e fuso", () => {
  it("lista do dia por data/status com cliente, veículo e situação", async () => {
    const at = new Date("2026-09-10T15:00:00Z");
    const a = await order([8000], { occurredAt: at });
    const b = await order([5000], { occurredAt: at });
    ok(await completeOrder(db, b.id, [{ method: "PIX", amountCents: 2000 }], at));
    await order([1000], { occurredAt: new Date("2026-09-12T15:00:00Z") });
    const day = await listOrders(db, { date: "2026-09-10" });
    expect(day.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    const done = await listOrders(db, { date: "2026-09-10", status: "DONE" });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      paymentStatus: "PARTIAL",
      balanceCents: 3000,
      customer: { name: "Maria Silva" },
    });
    expect(done[0].vehicle?.plate).toBe("ABC1D23");
    expect(await listOrders(db, { date: "2026-09-10", dateTo: "2026-09-12" })).toHaveLength(3);
    // data inválida cai em hoje (nenhuma OS nesse "hoje")
    const none = await listOrders(db, { date: "2026-02-31" }, new Date("2030-01-01T12:00:00Z"));
    expect(none).toEqual([]);
  });

  it("OS às 23:30 BRT (02:30Z do dia seguinte) pertence ao dia local", async () => {
    const o = await order([1000], { occurredAt: "2026-09-10T23:30:00-03:00" });
    expect((await listOrders(db, { date: "2026-09-10" })).map((x) => x.id)).toContain(o.id);
    expect((await listOrders(db, { date: "2026-09-11" })).map((x) => x.id)).not.toContain(o.id);
  });

  it("caixa do dia: totais por forma; pagamento 23:30 BRT cai no dia certo", async () => {
    const o = await order([8000]);
    ok(await completeOrder(db, o.id, []));
    const now = new Date("2026-09-20T12:00:00Z");
    const pay = (method: string, amountCents: number, occurredAt: string) =>
      registerPayment(db, o.id, { method, amountCents, occurredAt }, now);
    ok(await pay("PIX", 3000, "2026-09-10T23:30:00-03:00"));
    ok(await pay("CASH", 1000, "2026-09-11T00:10:00-03:00"));
    ok(await pay("PIX", 500, "2026-09-10T08:00:00-03:00"));
    const d10 = await getDayCash(db, { date: "2026-09-10" });
    expect(d10).toMatchObject({ date: "2026-09-10", totalCents: 3500 });
    expect(d10.totalsByMethod).toEqual({ CASH: 0, PIX: 3500, DEBIT_CARD: 0, CREDIT_CARD: 0 });
    expect(d10.entries).toHaveLength(2);
    expect(d10.entries[0]).toMatchObject({ orderId: o.id, customerName: "Maria Silva" });
    const d11 = await getDayCash(db, { date: "2026-09-11" });
    expect(d11.totalsByMethod.CASH).toBe(1000);
    expect(d11.totalCents).toBe(1000);
    // sem data = hoje (relativo ao "now" injetado; 05:00Z = 02:00 BRT do mesmo dia)
    expect((await getDayCash(db, {}, new Date("2026-09-11T05:00:00Z"))).date).toBe("2026-09-11");
    expect((await getDayCash(db, {}, new Date("2026-09-11T02:30:00Z"))).date).toBe("2026-09-10");
  });

  it("serviços disponíveis por tipo de veículo com preço sugerido", async () => {
    const car = await listServicesForVehicleType(db, { vehicleType: "CAR" });
    expect(car.map((s) => [s.name, s.suggestedPriceCents])).toEqual([
      ["Lavagem", 5000],
      ["Polimento", 8000],
    ]);
    const moto = await listServicesForVehicleType(db, { vehicleType: "MOTORCYCLE" });
    expect(moto.map((s) => s.name)).toEqual(["Capa", "Lavagem"]);
    await db.service.update({ where: { id: capa }, data: { active: false } });
    const m2 = await listServicesForVehicleType(db, { vehicleType: "MOTORCYCLE" });
    expect(m2.map((s) => s.name)).toEqual(["Lavagem"]);
    const q = await listServicesForVehicleType(db, { vehicleType: "CAR", q: "poli" });
    expect(q.map((s) => s.name)).toEqual(["Polimento"]);
  });
});

describe("exclusão de cadastros usados (canHardDelete, D-35)", () => {
  it("serviço usado em item não pode ser excluído (domínio e FK)", async () => {
    expect(await canHardDelete(db, "service", capa)).toBe(true);
    await order([5000]);
    expect(await canHardDelete(db, "service", lavagem)).toBe(false);
    const r = await deleteService(db, lavagem);
    expect(!r.ok && r.error).toBe(CAT.serviceInUse);
    await expect(db.service.delete({ where: { id: lavagem } })).rejects.toThrow();
    expect((await deleteService(db, capa)).ok).toBe(true);
  });

  it("produto usado em item PRODUCT não pode ser excluído; sem uso pode", async () => {
    const p = await createProduct(db, { name: "Cera" });
    if (!p.ok) throw new Error("p");
    expect(await canHardDelete(db, "product", p.data.id)).toBe(true);
    const o = await order([1000]);
    await db.serviceOrderItem.create({
      data: {
        orderId: o.id,
        kind: "PRODUCT",
        productId: p.data.id,
        description: "Cera",
        quantity: 1,
        unitPriceCents: 500,
        totalCents: 500,
      },
    });
    expect(await canHardDelete(db, "product", p.data.id)).toBe(false);
    await expect(db.product.delete({ where: { id: p.data.id } })).rejects.toThrow();
  });

  it("cliente e veículo com atendimentos não podem ser excluídos fisicamente (FK Restrict)", async () => {
    await order([1000]);
    await expect(db.customer.delete({ where: { id: customerId } })).rejects.toThrow();
    await expect(db.vehicle.delete({ where: { id: carId } })).rejects.toThrow();
  });
});

describe("categorias de caixa (seed idempotente)", () => {
  it("cria as padrão uma vez só", async () => {
    await db.cashCategory.deleteMany();
    expect(await ensureDefaultCashCategories(db)).toBe(DEFAULT_CASH_CATEGORIES.length);
    expect(await ensureDefaultCashCategories(db)).toBe(0);
    expect(await db.cashCategory.count()).toBe(9);
    expect(await db.cashCategory.count({ where: { direction: "IN" } })).toBe(2);
  });
});

describe("exclusão definitiva de cliente e de atendimento cancelado (D-47)", () => {
  const newCustomer = async (name: string, withVehicle = true) => {
    const c = await createCustomer(db, { name });
    if (!c.ok) throw new Error(c.error);
    if (withVehicle) {
      const v = await createVehicle(db, c.data.id, { type: "CAR", plate: null });
      if (!v.ok) throw new Error(v.error);
    }
    return c.data.id;
  };
  const orderFor = async (cid: number) => {
    const v = await db.vehicle.findFirstOrThrow({ where: { customerId: cid } });
    return ok(
      await createOrder(db, {
        customerId: cid,
        vehicleId: v.id,
        items: [{ serviceId: lavagem }],
      }),
    );
  };

  it("cliente sem atendimento é excluído junto com os veículos", async () => {
    const cid = await newCustomer("Teste Sem OS");
    await createVehicle(db, cid, { type: "MOTORCYCLE", plate: null });
    const r = await deleteCustomer(db, cid);
    expect(r).toEqual({ ok: true, data: { id: cid } });
    expect(await db.customer.count({ where: { id: cid } })).toBe(0);
    expect(await db.vehicle.count({ where: { customerId: cid } })).toBe(0);
    // os demais cadastros ficam intactos
    expect(await db.vehicle.count({ where: { customerId } })).toBe(2);
    expect(await deleteCustomer(db, cid)).toMatchObject({
      ok: false,
      error: MSGC.customerNotFound,
    });
    expect(await deleteCustomer(db, "x")).toMatchObject({ ok: false, error: MSGC.invalidId });
  });

  it("cliente com OS em andamento, concluída ou cancelada é recusado", async () => {
    const aberta = await newCustomer("Com aberta");
    await orderFor(aberta);
    expect(await deleteCustomer(db, aberta)).toMatchObject({
      ok: false,
      error: MSGC.customerHasOrders,
    });

    const concluida = await newCustomer("Com concluída");
    const o2 = await orderFor(concluida);
    ok(await completeOrder(db, o2.id, []));
    expect(await deleteCustomer(db, concluida)).toMatchObject({
      ok: false,
      error: MSGC.customerHasOrders,
    });

    const cancelada = await newCustomer("Com cancelada");
    const o3 = await orderFor(cancelada);
    ok(await cancelOrder(db, o3.id));
    expect(await deleteCustomer(db, cancelada)).toMatchObject({
      ok: false,
      error: MSGC.customerHasCanceledOrdersOnly,
    });

    // cancelada + aberta: mensagem geral (excluir a cancelada não bastaria)
    await orderFor(cancelada);
    expect(await deleteCustomer(db, cancelada)).toMatchObject({
      ok: false,
      error: MSGC.customerHasOrders,
    });
    for (const id of [aberta, concluida, cancelada]) {
      expect(await db.customer.count({ where: { id } })).toBe(1);
      expect(await db.vehicle.count({ where: { customerId: id } })).toBe(1);
    }
  });

  it("exclui OS cancelada (com itens); não toca em estoque nem em outras OS", async () => {
    const p = await createProduct(db, { name: "Óleo", salePriceCents: 1000 });
    if (!p.ok) throw new Error(p.error);
    const before = await db.product.findUniqueOrThrow({ where: { id: p.data.id } });
    const keep = await order([1000]);
    const o = await order([1000, 2000]);
    ok(await cancelOrder(db, o.id));
    const r = await deleteOrder(db, o.id);
    expect(r).toEqual({ ok: true, data: { id: o.id, customerId } });
    expect(await getOrderDetail(db, o.id)).toBeNull();
    expect(await db.serviceOrderItem.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.serviceOrderItem.count({ where: { orderId: keep.id } })).toBe(1);
    expect(await db.product.findUniqueOrThrow({ where: { id: p.data.id } })).toEqual(before);
    expect(await deleteOrder(db, o.id)).toMatchObject({ ok: false, error: MSG.orderNotFound });
    expect(await deleteOrder(db, 0)).toMatchObject({ ok: false, error: MSG.invalidId });
  });

  it("OS em andamento ou concluída nunca é excluída", async () => {
    const aberta = await order();
    expect(await deleteOrder(db, aberta.id)).toMatchObject({
      ok: false,
      error: MSG.deleteOnlyCanceled,
    });
    const paga = await order([5000]);
    ok(await completeOrder(db, paga.id, [{ method: "PIX", amountCents: 5000 }]));
    expect(await deleteOrder(db, paga.id)).toMatchObject({
      ok: false,
      error: MSG.deleteOnlyCanceled,
    });
    const fiado = await order();
    ok(await completeOrder(db, fiado.id, []));
    expect((await deleteOrder(db, fiado.id)).ok).toBe(false);
    expect(await db.serviceOrder.count()).toBe(3);
    expect(await db.cashEntry.count()).toBe(1);
  });

  it("OS cancelada com pagamento (forçado no banco) é recusada", async () => {
    const o = await order([5000]);
    ok(await cancelOrder(db, o.id));
    await db.cashEntry.create({
      data: {
        direction: "IN",
        amountCents: 100,
        method: "CASH",
        serviceOrderId: o.id,
        occurredAt: new Date(),
      },
    });
    expect(await deleteOrder(db, o.id)).toMatchObject({
      ok: false,
      error: MSG.deleteWithPayments,
    });
    expect(await db.serviceOrder.count({ where: { id: o.id } })).toBe(1);
    expect(await db.serviceOrderItem.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("fluxo do teste de fumaça: OS cancelada bloqueia serviço e cliente até ser excluída", async () => {
    const cid = await newCustomer("Cliente de teste");
    const svc = await createService(db, { name: "Serviço de teste", carPriceCents: 1000 });
    if (!svc.ok) throw new Error(svc.error);
    const v = await db.vehicle.findFirstOrThrow({ where: { customerId: cid } });
    const o = ok(
      await createOrder(db, {
        customerId: cid,
        vehicleId: v.id,
        items: [{ serviceId: svc.data.id }],
      }),
    );
    ok(await cancelOrder(db, o.id));

    expect(await canHardDelete(db, "service", svc.data.id)).toBe(false);
    expect((await deleteService(db, svc.data.id)).ok).toBe(false);
    expect((await deleteCustomer(db, cid)).ok).toBe(false);

    expect((await deleteOrder(db, o.id)).ok).toBe(true);

    expect(await canHardDelete(db, "service", svc.data.id)).toBe(true);
    expect((await deleteService(db, svc.data.id)).ok).toBe(true);
    expect((await deleteCustomer(db, cid)).ok).toBe(true);
    expect(await db.customer.count({ where: { id: cid } })).toBe(0);
    expect(await db.vehicle.count({ where: { customerId: cid } })).toBe(0);
  });
});
