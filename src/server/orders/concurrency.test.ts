// Concorrência nas escritas de OS (D-37/D-45). Roda em SQLite e em Postgres (npm run test:pg).
// O valor do teste em Postgres é maior: lá as transações realmente se intercalam.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProduct, createService } from "@/server/catalog/domain";
import { createCustomer, createVehicle } from "@/server/customers/domain";
import { createTestDb } from "@/server/customers/test-db";
import { registerStockIn } from "@/server/stock/domain";
import { getCustomerDebt, receiveFromCustomer } from "./debt";
import {
  completeOrder,
  createOrder,
  deletePayment,
  getOrderDetail,
  registerPayment,
  type ActionResult,
  type OrderDetail,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

let customerId = 0;
let vehicleId = 0;
let serviceId = 0;

beforeEach(async () => {
  await db.stockMovement.deleteMany();
  await db.cashEntry.deleteMany();
  await db.serviceOrderItem.deleteMany();
  await db.serviceOrder.deleteMany();
  await db.vehicle.deleteMany();
  await db.customer.deleteMany();
  await db.service.deleteMany();
  await db.product.deleteMany();
  const c = await createCustomer(db, { name: "Maria Silva" });
  if (!c.ok) throw new Error(c.error);
  customerId = c.data.id;
  const v = await createVehicle(db, customerId, { type: "CAR", plate: "ABC1D23" });
  if (!v.ok) throw new Error(v.error);
  vehicleId = v.data.id;
  const s = await createService(db, { name: "Lavagem", carPriceCents: 5000 });
  if (!s.ok) throw new Error(s.error);
  serviceId = s.data.id;
});

const okOf = (r: ActionResult<OrderDetail>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

async function openOrder() {
  return okOf(await createOrder(db, { customerId, vehicleId, items: [{ serviceId }] }));
}

describe("concorrência", () => {
  it("pagamentos simultâneos nunca passam do saldo e o cache bate com o caixa", async () => {
    const o = await openOrder();
    okOf(await completeOrder(db, o.id, [])); // fiado, total 5000
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        registerPayment(db, o.id, { amountCents: 2000, method: "PIX" }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2); // 2 x 2000 = 4000; o 3º excederia o saldo
    const d = await getOrderDetail(db, o.id);
    expect(d?.paidCents).toBe(4000);
    const entries = await db.cashEntry.aggregate({
      where: { serviceOrderId: o.id },
      _sum: { amountCents: true },
    });
    expect(entries._sum.amountCents).toBe(4000);
  });

  it("dupla conclusão simultânea grava um único conjunto de pagamentos", async () => {
    const o = await openOrder();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        completeOrder(db, o.id, [{ method: "CASH", amountCents: 5000 }]),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.cashEntry.count({ where: { serviceOrderId: o.id } })).toBe(1);
    expect((await getOrderDetail(db, o.id))?.paidCents).toBe(5000);
  });

  it("estorno simultâneo do mesmo pagamento: um só vence", async () => {
    const o = await openOrder();
    okOf(await completeOrder(db, o.id, [{ method: "CASH", amountCents: 5000 }]));
    const p = await db.cashEntry.findFirstOrThrow({ where: { serviceOrderId: o.id } });
    const results = await Promise.all([deletePayment(db, p.id), deletePayment(db, p.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await getOrderDetail(db, o.id))?.paidCents).toBe(0);
  });

  it("recebimentos do cliente simultâneos (e misturados com pagamento por OS) nunca passam da dívida", async () => {
    const a = await openOrder();
    const b = await openOrder();
    okOf(await completeOrder(db, a.id, [])); // 5000 em aberto
    okOf(await completeOrder(db, b.id, [])); // 5000 em aberto
    const results = await Promise.all([
      ...Array.from({ length: 8 }, () =>
        receiveFromCustomer(db, customerId, { amountCents: 3000, method: "PIX" }),
      ),
      registerPayment(db, a.id, { amountCents: 500, method: "CASH" }),
      registerPayment(db, b.id, { amountCents: 500, method: "CASH" }),
    ]);
    const total =
      (await db.cashEntry.aggregate({ _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    expect(total).toBeLessThanOrEqual(10000);
    expect((await getCustomerDebt(db, customerId))?.balanceCents).toBe(10000 - total);
    for (const id of [a.id, b.id]) {
      const d = await getOrderDetail(db, id);
      const sum = await db.cashEntry.aggregate({
        where: { serviceOrderId: id },
        _sum: { amountCents: true },
      });
      expect(d?.paidCents).toBe(sum._sum.amountCents ?? 0);
      expect(d?.paidCents).toBeLessThanOrEqual(d?.totalCents ?? 0);
    }
    // 8 x 3000 competem por 10000: pelo menos 2 passam e nunca mais que 3.
    const okCount = results.slice(0, 8).filter((r) => r.ok).length;
    expect(okCount).toBeGreaterThanOrEqual(2);
    expect(okCount).toBeLessThanOrEqual(3);
  });

  it("conclusões simultâneas disputando o estoque nunca vendem mais que o saldo (E9)", async () => {
    const p = await createProduct(db, { name: "Óleo", salePriceCents: 3000 });
    if (!p.ok) throw new Error(p.error);
    const productId = p.data.id;
    const s = await registerStockIn(db, { productId, quantity: 3 });
    if (!s.ok) throw new Error(s.error);
    const orders = [];
    for (let i = 0; i < 5; i++) {
      orders.push(okOf(await createOrder(db, { customerId, products: [{ productId }] })));
    }
    const results = await Promise.all(orders.map((o) => completeOrder(db, o.id, [])));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const sum = await db.stockMovement.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(sum._sum.quantity).toBe(0);
    expect(product.stockQuantity).toBe(0);
    expect(await db.serviceOrder.count({ where: { status: "DONE" } })).toBe(3);
  });
});
