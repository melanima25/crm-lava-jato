// Venda de produto no atendimento (E9, D-15): itens PRODUCT, baixa SALE automática e reversões.
// Cobre cada linha da tabela "Regras de estoque na venda" (docs/modelo-dados.md). Roda em SQLite e Postgres.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDefaultCashCategories } from "@/server/cash/categories";
import { createProduct, createService, setProductActive } from "@/server/catalog/domain";
import { createCustomer, createVehicle } from "@/server/customers/domain";
import { createTestDb } from "@/server/customers/test-db";
import {
  deleteStockMovement,
  registerStockIn,
  STOCK_MSG,
  updateStockMovement,
} from "@/server/stock/domain";
import {
  addProductItem,
  addServiceItem,
  cancelOrder,
  completeOrder,
  createOrder,
  deleteOrder,
  deletePayment,
  listProductsForSale,
  MSG,
  registerPayment,
  removeOrderItem,
  updateOrder,
  updateOrderItem,
  type ActionResult,
  type OrderDetail,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

const NOW = new Date("2026-10-02T15:00:00.000Z");

const okOf = <T>(r: ActionResult<T>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

let customerId = 0;
let carId = 0;
let lavagem = 0; // carro 5000
let oleo = 0; // venda 3000, estoque 10
let cera = 0; // venda 2500, estoque 1
let interno = 0; // sem preço de venda (uso interno)

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
  customerId = okOf(await createCustomer(db, { name: "João Souza" })).id;
  carId = okOf(await createVehicle(db, customerId, { type: "CAR", plate: "ABC1D23" })).id;
  lavagem = okOf(
    await createService(db, { name: "Lavagem", carPriceCents: 5000, motorcyclePriceCents: null }),
  ).id;
  const product = async (name: string, salePriceCents: number | null, stock: number) => {
    const id = okOf(await createProduct(db, { name, unit: "frasco", salePriceCents })).id;
    if (stock > 0) okOf(await registerStockIn(db, { productId: id, quantity: stock }, NOW));
    return id;
  };
  oleo = await product("Óleo de motor", 3000, 10);
  cera = await product("Cera", 2500, 1);
  interno = await product("Shampoo automotivo", null, 5);
});

const stockOf = async (id: number) =>
  (await db.product.findUniqueOrThrow({ where: { id } })).stockQuantity;

/** Cache = Σ movimentações e nunca negativo. */
async function expectInvariant(...ids: number[]) {
  for (const id of ids) {
    const sum = await db.stockMovement.aggregate({
      where: { productId: id },
      _sum: { quantity: true },
    });
    expect(await stockOf(id)).toBe(sum._sum.quantity ?? 0);
    expect(await stockOf(id)).toBeGreaterThanOrEqual(0);
  }
}

const sales = () => db.stockMovement.findMany({ where: { type: "SALE" }, orderBy: { id: "asc" } });

/** OS sem veículo só com produtos (ou com serviço + veículo quando `withService`). */
async function order(
  products: { productId: number; quantity?: number; unitPriceCents?: number }[],
  withService = false,
): Promise<OrderDetail> {
  return okOf(
    await createOrder(db, {
      customerId,
      vehicleId: withService ? carId : null,
      items: withService ? [{ serviceId: lavagem }] : [],
      products,
    }),
  );
}

const productItem = (o: OrderDetail, productId: number) =>
  o.items.find((i) => i.kind === "PRODUCT" && i.productId === productId)!;

describe("produtos à venda e criação do item", () => {
  it("lista só produtos ativos com preço de venda, com estoque", async () => {
    okOf(await setProductActive(db, cera, false));
    const list = await listProductsForSale(db);
    expect(list.map((p) => p.id)).toEqual([oleo]);
    expect(list[0]).toMatchObject({ salePriceCents: 3000, stockQuantity: 10, unit: "frasco" });
  });

  it("produto sem preço de venda não pode ser vendido (criação e adição)", async () => {
    const r = await createOrder(db, { customerId, products: [{ productId: interno }] });
    expect(!r.ok && r.error).toBe(MSG.productNotForSale);
    expect(!r.ok && r.fieldErrors?.["products.0.productId"]).toBe(MSG.productNotForSale);
    const o = await order([{ productId: oleo }]);
    const a = await addProductItem(db, o.id, { productId: interno });
    expect(!a.ok && a.error).toBe(MSG.productNotForSale);
  });

  it("produto inativo ou inexistente não pode ser adicionado", async () => {
    okOf(await setProductActive(db, cera, false));
    const r = await createOrder(db, { customerId, products: [{ productId: cera }] });
    expect(!r.ok && r.error).toBe(MSG.productInactive);
    const r2 = await createOrder(db, { customerId, products: [{ productId: 999999 }] });
    expect(!r2.ok && r2.error).toBe(MSG.productNotFound);
  });

  it("atendimento só com produtos dispensa veículo; com serviço continua exigindo", async () => {
    const o = await order([{ productId: oleo, quantity: 2 }]);
    expect(o.vehicle).toBeNull();
    expect(productItem(o, oleo)).toMatchObject({
      description: "Óleo de motor",
      quantity: 2,
      unitPriceCents: 3000,
      totalCents: 6000,
      unit: "frasco",
      stockQuantity: 10,
    });
    const r = await createOrder(db, {
      customerId,
      items: [{ serviceId: lavagem }],
      products: [{ productId: oleo }],
    });
    expect(!r.ok && r.error).toBe(MSG.vehicleRequired);
    // Sem veículo não dá para adicionar serviço depois; produto dá.
    const s = await addServiceItem(db, o.id, { serviceId: lavagem });
    expect(!s.ok && s.error).toBe(MSG.vehicleRequired);
    expect((await addProductItem(db, o.id, { productId: cera })).ok).toBe(true);
    // Remover o veículo de OS só com produtos é permitido.
    const withCar = okOf(
      await createOrder(db, { customerId, vehicleId: carId, products: [{ productId: oleo }] }),
    );
    expect(okOf(await updateOrder(db, withCar.id, { vehicleId: null })).vehicle).toBeNull();
  });

  it("preço sugerido = preço de venda, editável; soma no total com serviço e desconto", async () => {
    const o = okOf(
      await createOrder(db, {
        customerId,
        vehicleId: carId,
        items: [{ serviceId: lavagem }],
        products: [{ productId: oleo, quantity: 2, unitPriceCents: 2800 }],
        discountCents: 600,
      }),
    );
    expect(o.subtotalCents).toBe(5000 + 5600);
    expect(o.totalCents).toBe(10000);
  });
});

describe("OS em andamento (OPEN): estoque não muda", () => {
  it("adicionar, alterar e remover produto não mexe no estoque", async () => {
    const o = await order([{ productId: oleo, quantity: 2 }]);
    const a = okOf(await addProductItem(db, o.id, { productId: cera }));
    okOf(await updateOrderItem(db, productItem(a, oleo).id, { quantity: 5 }));
    okOf(await removeOrderItem(db, productItem(a, cera).id));
    expect(await stockOf(oleo)).toBe(10);
    expect(await stockOf(cera)).toBe(1);
    expect(await sales()).toHaveLength(0);
  });

  it("cancelar OS em andamento não mexe no estoque", async () => {
    const o = await order([{ productId: oleo, quantity: 2 }]);
    okOf(await cancelOrder(db, o.id));
    expect(await stockOf(oleo)).toBe(10);
    expect(await sales()).toHaveLength(0);
  });
});

describe("conclusão (OPEN → DONE)", () => {
  it("cria uma baixa SALE por item de produto, ligada ao item; serviço não gera movimentação", async () => {
    const o = await order([{ productId: oleo, quantity: 2 }], true);
    const done = okOf(await completeOrder(db, o.id, [], NOW));
    expect(done.status).toBe("DONE");
    expect(await stockOf(oleo)).toBe(8);
    const s = await sales();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      productId: oleo,
      quantity: -2,
      serviceOrderItemId: productItem(done, oleo).id,
      reason: `Venda OS nº ${o.id}`,
    });
    expect(s[0].occurredAt.toISOString()).toBe(NOW.toISOString());
    expect(
      await db.stockMovement.count({ where: { productId: { not: oleo }, type: "SALE" } }),
    ).toBe(0);
    await expectInvariant(oleo, cera);
  });

  it("segue as mesmas regras de pagamento: Fiado, misto e pago", async () => {
    const fiado = okOf(await completeOrder(db, (await order([{ productId: oleo }])).id, [], NOW));
    expect(fiado.paymentStatus).toBe("UNPAID");
    const misto = okOf(
      await completeOrder(
        db,
        (await order([{ productId: oleo, quantity: 2 }])).id,
        [{ method: "PIX", amountCents: 1000 }],
        NOW,
      ),
    );
    expect(misto).toMatchObject({ paymentStatus: "PARTIAL", paidCents: 1000, balanceCents: 5000 });
    const pago = okOf(
      await completeOrder(
        db,
        (await order([{ productId: oleo }])).id,
        [{ method: "CASH", amountCents: 3000 }],
        NOW,
      ),
    );
    expect(pago.paymentStatus).toBe("PAID");
    expect(await stockOf(oleo)).toBe(6);
  });

  it("estoque insuficiente bloqueia e nada é gravado (status, caixa e estoque)", async () => {
    const o = await order([{ productId: oleo }, { productId: cera, quantity: 2 }]);
    const r = await completeOrder(db, o.id, [{ method: "CASH", amountCents: 1000 }], NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Cera");
    expect(r.error).toContain("disponível 1 frasco");
    expect(r.fieldErrors?.stockProductId).toBe(String(cera));
    const after = await db.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe("OPEN");
    expect(after.completedAt).toBeNull();
    expect(await db.cashEntry.count({ where: { serviceOrderId: o.id } })).toBe(0);
    expect(await sales()).toHaveLength(0);
    expect(await stockOf(oleo)).toBe(10);
    expect(await stockOf(cera)).toBe(1);
  });

  it("soma itens do mesmo produto ao conferir o saldo", async () => {
    const o = await order([{ productId: cera }]);
    okOf(await addProductItem(db, o.id, { productId: cera }));
    const r = await completeOrder(db, o.id, [], NOW);
    expect(!r.ok && r.error).toContain("necessário 2");
    expect(await stockOf(cera)).toBe(1);
  });

  it("produto inativado depois de entrar na OS ainda pode ser concluído", async () => {
    const o = await order([{ productId: oleo }]);
    okOf(await setProductActive(db, oleo, false));
    okOf(await completeOrder(db, o.id, [], NOW));
    expect(await stockOf(oleo)).toBe(9);
  });
});

describe("OS concluída (DONE)", () => {
  async function doneOrder(quantity = 2) {
    const o = await order([{ productId: oleo, quantity }], true);
    return okOf(await completeOrder(db, o.id, [], NOW));
  }

  it("adicionar produto baixa na hora", async () => {
    const o = await doneOrder();
    const a = okOf(await addProductItem(db, o.id, { productId: cera }, NOW));
    expect(await stockOf(cera)).toBe(0);
    const sale = await db.stockMovement.findUniqueOrThrow({
      where: { serviceOrderItemId: productItem(a, cera).id },
    });
    expect(sale).toMatchObject({ type: "SALE", quantity: -1 });
    expect(a.totalCents).toBe(5000 + 6000 + 2500);
  });

  it("adicionar sem estoque é bloqueado e o item não fica na OS", async () => {
    const o = await doneOrder();
    okOf(await addProductItem(db, o.id, { productId: cera }, NOW));
    const r = await addProductItem(db, o.id, { productId: cera }, NOW);
    expect(!r.ok && r.fieldErrors?.stockProductId).toBe(String(cera));
    expect(await db.serviceOrderItem.count({ where: { orderId: o.id, productId: cera } })).toBe(1);
    expect(await stockOf(cera)).toBe(0);
  });

  it("alterar quantidade ajusta a baixa pela diferença (2 → 3 ⇒ −1; 3 → 1 ⇒ +2)", async () => {
    const o = await doneOrder();
    const itemId = productItem(o, oleo).id;
    okOf(await updateOrderItem(db, itemId, { quantity: 3 }));
    expect(await stockOf(oleo)).toBe(7);
    okOf(await updateOrderItem(db, itemId, { quantity: 1 }));
    expect(await stockOf(oleo)).toBe(9);
    expect(await sales()).toHaveLength(1);
    expect((await sales())[0].quantity).toBe(-1);
    // Só preço: estoque não muda.
    okOf(await updateOrderItem(db, itemId, { unitPriceCents: 100 }));
    expect(await stockOf(oleo)).toBe(9);
    await expectInvariant(oleo);
  });

  it("aumentar acima do saldo é bloqueado e nada muda", async () => {
    const o = await doneOrder(9); // sobra 1
    const itemId = productItem(o, oleo).id;
    const r = await updateOrderItem(db, itemId, { quantity: 11 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("disponível 1 frasco, necessário 2");
    expect(r.fieldErrors?.stockProductId).toBe(String(oleo));
    expect((await db.serviceOrderItem.findUniqueOrThrow({ where: { id: itemId } })).quantity).toBe(
      9,
    );
    expect(await stockOf(oleo)).toBe(1);
    // Exatamente o saldo passa.
    okOf(await updateOrderItem(db, itemId, { quantity: 10 }));
    expect(await stockOf(oleo)).toBe(0);
  });

  it("remover o item devolve a quantidade ao estoque", async () => {
    const o = await doneOrder();
    okOf(await removeOrderItem(db, productItem(o, oleo).id));
    expect(await stockOf(oleo)).toBe(10);
    expect(await sales()).toHaveLength(0);
  });

  it("OS concluída não fica sem itens (último item de produto)", async () => {
    const o = okOf(await completeOrder(db, (await order([{ productId: oleo }])).id, [], NOW));
    const r = await removeOrderItem(db, productItem(o, oleo).id);
    expect(!r.ok && r.error).toBe(MSG.lastItemDone);
    expect(await stockOf(oleo)).toBe(9);
  });

  it("cancelar devolve ao estoque tudo o que a OS baixou; depois pode excluir", async () => {
    const o = await doneOrder();
    okOf(await addProductItem(db, o.id, { productId: cera }, NOW));
    expect([await stockOf(oleo), await stockOf(cera)]).toEqual([8, 0]);
    okOf(await cancelOrder(db, o.id));
    expect([await stockOf(oleo), await stockOf(cera)]).toEqual([10, 1]);
    expect(await sales()).toHaveLength(0);
    okOf(await deleteOrder(db, o.id));
    await expectInvariant(oleo, cera);
  });

  it("cancelar com pagamento continua bloqueado e não devolve estoque", async () => {
    const o = await doneOrder();
    okOf(await registerPayment(db, o.id, { method: "PIX", amountCents: 1000 }, NOW));
    const r = await cancelOrder(db, o.id);
    expect(!r.ok && r.error).toBe(MSG.cancelWithPayments);
    expect(await stockOf(oleo)).toBe(8);
  });

  it("estornar pagamento não altera o estoque", async () => {
    const o = await doneOrder();
    const paid = okOf(await registerPayment(db, o.id, { method: "PIX", amountCents: 1000 }, NOW));
    okOf(await deletePayment(db, paid.payments[0].id));
    expect(await stockOf(oleo)).toBe(8);
    expect(await sales()).toHaveLength(1);
  });

  it("serviço em OS concluída continua sem mexer no estoque", async () => {
    const o = await doneOrder();
    const a = okOf(await addServiceItem(db, o.id, { serviceId: lavagem }));
    const svc = a.items.filter((i) => i.kind === "SERVICE");
    okOf(await updateOrderItem(db, svc[1].id, { quantity: 3 }));
    okOf(await removeOrderItem(db, svc[1].id));
    expect(await stockOf(oleo)).toBe(8);
    expect(await db.stockMovement.count({ where: { type: "SALE" } })).toBe(1);
  });
});

describe("baixa SALE protegida e invariante", () => {
  it("a tela de estoque não edita nem exclui a baixa da venda", async () => {
    const o = await order([{ productId: oleo, quantity: 2 }]);
    okOf(await completeOrder(db, o.id, [], NOW));
    const [sale] = await sales();
    const d = await deleteStockMovement(db, sale.id);
    expect(!d.ok && d.error).toBe(STOCK_MSG.saleLocked);
    const u = await updateStockMovement(db, sale.id, { quantity: 1 }, NOW);
    expect(!u.ok && u.error).toBe(STOCK_MSG.saleLocked);
    expect(await stockOf(oleo)).toBe(8);
  });

  it("stockQuantity = Σ movimentações após qualquer sequência", async () => {
    const a = await order([{ productId: oleo, quantity: 3 }], true);
    const b = await order([{ productId: oleo }, { productId: cera }]);
    okOf(await completeOrder(db, a.id, [], NOW));
    okOf(await completeOrder(db, b.id, [{ method: "CASH", amountCents: 500 }], NOW));
    const doneA = okOf(await addProductItem(db, a.id, { productId: oleo, quantity: 2 }, NOW));
    const second = doneA.items.filter((i) => i.productId === oleo)[1];
    okOf(await updateOrderItem(db, second.id, { quantity: 4 }));
    okOf(await removeOrderItem(db, productItem(doneA, oleo).id));
    okOf(await registerStockIn(db, { productId: cera, quantity: 3 }, NOW));
    okOf(await cancelOrder(db, a.id));
    await expectInvariant(oleo, cera);
    expect(await stockOf(oleo)).toBe(9); // só a OS b segue vendida
    expect(await stockOf(cera)).toBe(3);
  });
});
