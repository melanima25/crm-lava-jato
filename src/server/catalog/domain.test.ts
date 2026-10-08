import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/customers/test-db";
import {
  canHardDelete,
  createProduct,
  createService,
  deleteProduct,
  deleteService,
  getProductById,
  getServiceById,
  MSG,
  searchProducts,
  searchServices,
  setProductActive,
  setServiceActive,
  updateProduct,
  updateService,
  type ProductDTO,
  type ServiceDTO,
} from "./domain";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

beforeEach(async () => {
  await db.service.deleteMany();
  await db.product.deleteMany();
});

async function service(name: string, car: number | null = 5000, moto: number | null = null) {
  const r = await createService(db, { name, carPriceCents: car, motorcyclePriceCents: moto });
  if (!r.ok) throw new Error(r.error);
  return r.data as ServiceDTO;
}

async function product(name: string, salePriceCents: number | null = null) {
  const r = await createProduct(db, { name, salePriceCents });
  if (!r.ok) throw new Error(r.error);
  return r.data as ProductDTO;
}

describe("serviços", () => {
  it("cria com ao menos um preço e preserva null para o outro tipo", async () => {
    const s = await service("Lavagem completa", 6000, null);
    expect(s).toMatchObject({ carPriceCents: 6000, motorcyclePriceCents: null, active: true });
  });

  it("rejeita sem preço, com preço negativo ou zero, com fieldErrors", async () => {
    const none = await createService(db, { name: "X1" });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(Object.keys(none.fieldErrors ?? {})).toContain("carPriceCents");
    for (const bad of [-100, 0]) {
      const r = await createService(db, { name: "X2", carPriceCents: bad });
      expect(r.ok).toBe(false);
    }
    expect(await db.service.count()).toBe(0);
  });

  it("nome duplicado sem diferenciar caixa/acento, com erro no campo name", async () => {
    await service("Polimento de Farol");
    const r = await createService(db, { name: "  polímento de FAROL ", carPriceCents: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(MSG.serviceNameTaken);
      expect(r.fieldErrors?.name).toBe(MSG.serviceNameTaken);
    }
  });

  it("atualiza; permite manter o próprio nome (mudando acento/caixa) mas não o de outro", async () => {
    const a = await service("Cera");
    const b = await service("Lavagem");
    const ok = await updateService(db, a.id, { name: "CÉRA", carPriceCents: 7000 });
    expect(ok.ok).toBe(true);
    expect(await getServiceById(db, a.id)).toMatchObject({ name: "CÉRA", carPriceCents: 7000 });
    const dup = await updateService(db, b.id, { name: "cera", carPriceCents: 100 });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.fieldErrors?.name).toBe(MSG.serviceNameTaken);
  });

  it("atualizar remove um preço (vazio = não oferecido) mas não os dois", async () => {
    const a = await service("Cera", 5000, 3000);
    const r = await updateService(db, a.id, {
      name: "Cera",
      carPriceCents: 5000,
      motorcyclePriceCents: "",
    });
    expect(r.ok && r.data.motorcyclePriceCents).toBeNull();
    const bad = await updateService(db, a.id, { name: "Cera", carPriceCents: null });
    expect(bad.ok).toBe(false);
  });

  it("id inexistente/inválido retorna erro", async () => {
    const r = await updateService(db, 999, { name: "Cera", carPriceCents: 100 });
    expect(r).toMatchObject({ ok: false, error: MSG.serviceNotFound });
    expect(await setServiceActive(db, 999, false)).toMatchObject({ ok: false });
    expect(await deleteService(db, 999)).toMatchObject({ ok: false, error: MSG.serviceNotFound });
    expect(await deleteService(db, "abc")).toMatchObject({ ok: false, error: MSG.invalidId });
    expect(await getServiceById(db, -1)).toBeNull();
  });

  it("inativa e reativa; inativos saem da lista padrão", async () => {
    const a = await service("Cera");
    await service("Lavagem");
    await setServiceActive(db, a.id, false);
    expect((await searchServices(db)).map((s) => s.name)).toEqual(["Lavagem"]);
    expect(await searchServices(db, { includeInactive: true })).toHaveLength(2);
    await setServiceActive(db, a.id, true);
    expect(await searchServices(db)).toHaveLength(2);
  });

  it("exclui definitivamente e libera o nome", async () => {
    const a = await service("Cera");
    const r = await deleteService(db, a.id);
    expect(r).toEqual({ ok: true, data: { id: a.id } });
    expect(await getServiceById(db, a.id)).toBeNull();
    await service("Cera");
  });

  it("busca sem acento/caixa, ordenada por nome; curingas não casam tudo", async () => {
    await service("Revitalização de plásticos");
    await service("Lavagem de motor");
    await service("Cera");
    expect((await searchServices(db, { q: "REVITALIZACAO" })).map((s) => s.name)).toEqual([
      "Revitalização de plásticos",
    ]);
    expect((await searchServices(db, { q: "plastico" })).length).toBe(1);
    expect((await searchServices(db)).map((s) => s.name)).toEqual([
      "Cera",
      "Lavagem de motor",
      "Revitalização de plásticos",
    ]);
    expect(await searchServices(db, { q: "%" })).toEqual([]);
    expect(await searchServices(db, { q: "_" })).toEqual([]);
    expect(await searchServices(db, { q: " % _ " })).toEqual([]);
    expect(await searchServices(db, { q: "   " })).toHaveLength(3);
    expect(await searchServices(db, { q: "zzz" })).toEqual([]);
  });
});

describe("produtos", () => {
  it("cria com defaults (unidade un, sem preço, estoque 0)", async () => {
    const p = await product("Shampoo automotivo");
    expect(p).toMatchObject({
      unit: "un",
      salePriceCents: null,
      stockQuantity: 0,
      active: true,
      description: null,
    });
  });

  it("nome duplicado sem acento e preço inválido", async () => {
    await product("Cera líquida");
    const dup = await createProduct(db, { name: "CERA LIQUIDA" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.fieldErrors?.name).toBe(MSG.productNameTaken);
    const neg = await createProduct(db, { name: "Outro", salePriceCents: -1 });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.fieldErrors?.salePriceCents).toBeTruthy();
  });

  it("atualiza sem alterar o estoque; pode limpar o preço", async () => {
    const p = await product("Óleo", 3500);
    await db.product.update({ where: { id: p.id }, data: { stockQuantity: 7 } });
    const r = await updateProduct(db, p.id, {
      name: "Óleo 1L",
      unit: "frasco",
      salePriceCents: null,
    });
    expect(r.ok && r.data).toMatchObject({
      name: "Óleo 1L",
      unit: "frasco",
      salePriceCents: null,
      stockQuantity: 7,
    });
    const dup = await product("Aromatizante");
    const bad = await updateProduct(db, dup.id, { name: "oleo 1l" });
    expect(bad.ok).toBe(false);
  });

  it("inativa, exclui e busca", async () => {
    const a = await product("Pretinho");
    await product("Flanela");
    await setProductActive(db, a.id, false);
    expect((await searchProducts(db)).map((p) => p.name)).toEqual(["Flanela"]);
    expect(await searchProducts(db, { q: "PRETINHO", includeInactive: true })).toHaveLength(1);
    expect(await searchProducts(db, { q: "%" })).toEqual([]);
    expect(await deleteProduct(db, a.id)).toMatchObject({ ok: true });
    expect(await getProductById(db, a.id)).toBeNull();
    expect(await deleteProduct(db, a.id)).toMatchObject({ error: MSG.productNotFound });
  });
});

describe("canHardDelete", () => {
  it("sem uso libera a exclusão", async () => {
    expect(await canHardDelete(db, "service", 1)).toBe(true);
    expect(await canHardDelete(db, "product", 1)).toBe(true);
  });

  it("produto com movimentação de estoque não pode ser excluído (E8)", async () => {
    const p = await product("Cera");
    await db.stockMovement.create({
      data: { productId: p.id, type: "IN", quantity: 1, occurredAt: new Date() },
    });
    expect(await canHardDelete(db, "product", p.id)).toBe(false);
    const r = await deleteProduct(db, p.id);
    expect(r).toMatchObject({ ok: false, error: MSG.productInUse });
    await db.stockMovement.deleteMany();
  });
});
