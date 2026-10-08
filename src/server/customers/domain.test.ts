import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCustomer,
  createVehicle,
  getCustomerDetail,
  MSG,
  searchCustomers,
  setCustomerActive,
  setVehicleActive,
  updateCustomer,
  updateVehicle,
  type CustomerDTO,
  type VehicleDTO,
} from "./domain";
import { createTestDb } from "./test-db";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());

beforeEach(async () => {
  await db.vehicle.deleteMany();
  await db.customer.deleteMany();
});

async function customer(name: string, phone?: string): Promise<CustomerDTO> {
  const r = await createCustomer(db, { name, phone });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
async function vehicle(customerId: number, input: object): Promise<VehicleDTO> {
  const r = await createVehicle(db, customerId, input);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const names = async (q: string, includeInactive = false) =>
  (await searchCustomers(db, { q, includeInactive })).map((c) => c.name);

describe("cliente", () => {
  it("cria com telefone só dígitos e atualiza", async () => {
    const c = await customer("João Ávila", "(11) 98765-4321");
    expect(c.phone).toBe("11987654321");
    const u = await updateCustomer(db, c.id, { name: "João Silva", phone: "", notes: "vip" });
    expect(u).toMatchObject({ ok: true, data: { name: "João Silva", phone: null, notes: "vip" } });
    expect(await names("silva")).toEqual(["João Silva"]);
    expect(await names("avila")).toEqual([]); // searchName foi atualizado
  });
  it("valida entrada e ids", async () => {
    const r = await createCustomer(db, { name: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.name).toBeTruthy();
    expect(await updateCustomer(db, 999, { name: "Fulano" })).toMatchObject({
      ok: false,
      error: MSG.customerNotFound,
    });
    expect(await updateCustomer(db, "x", { name: "Fulano" })).toMatchObject({
      ok: false,
      error: MSG.invalidId,
    });
  });
});

describe("busca", () => {
  it("nome contém, sem diferenciar caixa nem acento (nos dois sentidos)", async () => {
    await customer("José da Conceição");
    await customer("Maria Souza");
    expect(await names("jose")).toEqual(["José da Conceição"]);
    expect(await names("JOSÉ")).toEqual(["José da Conceição"]);
    expect(await names("conceicao")).toEqual(["José da Conceição"]);
    expect(await names("ceição")).toEqual(["José da Conceição"]);
    expect(await names("ouza")).toEqual(["Maria Souza"]);
  });
  it("telefone por dígitos parciais, com máscara", async () => {
    await customer("Ana", "11987654321");
    await customer("Bia", "21955550000");
    expect(await names("98765")).toEqual(["Ana"]);
    expect(await names("(11) 98765")).toEqual(["Ana"]);
    expect(await names("5550000")).toEqual(["Bia"]);
  });
  it("placa Mercosul e antiga, normalizada e parcial", async () => {
    const a = await customer("Ana");
    const b = await customer("Bia");
    await vehicle(a.id, { type: "CAR", plate: "abc-1d23" });
    await vehicle(b.id, { type: "MOTORCYCLE", plate: "xyz 9876" });
    for (const q of ["abc1d23", "ABC-1D23", "abc 1d2", "1d23"])
      expect(await names(q)).toEqual(["Ana"]);
    for (const q of ["XYZ9876", "xyz-9876", "9876"]) expect(await names(q)).toEqual(["Bia"]);
  });
  it("placa de veículo inativo ainda encontra o cliente", async () => {
    const a = await customer("Ana");
    const v = await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    await setVehicleActive(db, v.id, false);
    expect(await names("ABC1D23")).toEqual(["Ana"]);
  });
  it("padrão só ativos; includeInactive traz todos", async () => {
    const a = await customer("Ana");
    await customer("Bia");
    await setCustomerActive(db, a.id, false);
    expect(await names("")).toEqual(["Bia"]);
    expect(await names("ana")).toEqual([]);
    expect(await names("", true)).toEqual(["Ana", "Bia"]);
    await setCustomerActive(db, a.id, true);
    expect(await names("ana")).toEqual(["Ana"]);
  });
  it("ordena por nome ignorando acento/caixa e conta veículos ativos", async () => {
    const z = await customer("zeca");
    await customer("Álvaro");
    await customer("beto");
    const v1 = await vehicle(z.id, { type: "CAR" });
    await vehicle(z.id, { type: "MOTORCYCLE" });
    await setVehicleActive(db, v1.id, false);
    const list = await searchCustomers(db);
    expect(list.map((c) => c.name)).toEqual(["Álvaro", "beto", "zeca"]);
    expect(list.map((c) => c.activeVehicleCount)).toEqual([0, 0, 1]);
  });
  it("entradas sem correspondência ou com símbolos não quebram", async () => {
    await customer("Ana");
    expect(await names("a_a")).toEqual([]); // "_" não é curinga
    expect(await names("%")).toEqual([]); // só curingas: há busca, mas nada a procurar
    expect(await names("%_%")).toEqual([]);
    expect(await names("   ")).toEqual(["Ana"]); // só espaços = sem busca, lista tudo
  });
});

describe("veículo", () => {
  it("cria vários por cliente; detalhe traz veículos", async () => {
    const c = await customer("Ana");
    await vehicle(c.id, { type: "CAR", plate: "abc-1234", brand: "Fiat" });
    const m = await vehicle(c.id, { type: "MOTORCYCLE" });
    expect(m.plate).toBeNull();
    const d = await getCustomerDetail(db, c.id);
    expect(d?.vehicles).toHaveLength(2);
    expect(d?.vehicles[0]).toMatchObject({ plate: "ABC1234", type: "CAR", brand: "Fiat" });
    expect(await getCustomerDetail(db, 999)).toBeNull();
  });
  it("vários veículos sem placa são permitidos", async () => {
    const c = await customer("Ana");
    await vehicle(c.id, { type: "CAR" });
    await vehicle(c.id, { type: "CAR" });
  });
  it("placa duplicada indica o dono (normalização e caixa ignoradas)", async () => {
    const a = await customer("Ana Lima");
    const b = await customer("Bia");
    await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    const r = await createVehicle(db, b.id, { type: "CAR", plate: "abc-1d23" });
    expect(r).toMatchObject({
      ok: false,
      error: "Esta placa já está cadastrada para o cliente Ana Lima",
      fieldErrors: { plate: "Esta placa já está cadastrada para o cliente Ana Lima" },
    });
  });
  it("duplicidade vale contra veículo inativo e contra cliente inativo", async () => {
    const a = await customer("Ana Lima");
    const b = await customer("Bia");
    const v = await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    await setVehicleActive(db, v.id, false);
    await setCustomerActive(db, a.id, false);
    const r = await createVehicle(db, b.id, { type: "CAR", plate: "ABC1D23" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("Ana Lima");
  });
  it("edição: manter a própria placa é ok; trocar para placa de outro é rejeitado", async () => {
    const a = await customer("Ana");
    const v1 = await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    await vehicle(a.id, { type: "CAR", plate: "XYZ9876" });
    expect(
      await updateVehicle(db, v1.id, { type: "CAR", plate: "abc1d23", color: "Preto" }),
    ).toMatchObject({
      ok: true,
      data: { color: "Preto" },
    });
    const r = await updateVehicle(db, v1.id, { type: "CAR", plate: "XYZ-9876" });
    expect(r.ok).toBe(false);
  });
  it("exige tipo e placa válida", async () => {
    const c = await customer("Ana");
    expect((await createVehicle(db, c.id, { plate: "ABC1D23" })).ok).toBe(false);
    expect((await createVehicle(db, c.id, { type: "CAR", plate: "123" })).ok).toBe(false);
  });
  it("transfere para outro cliente ativo", async () => {
    const a = await customer("Ana");
    const b = await customer("Bia");
    const v = await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    const r = await updateVehicle(db, v.id, { type: "CAR", plate: "ABC1D23", customerId: b.id });
    expect(r).toMatchObject({ ok: true, data: { customerId: b.id } });
    await setCustomerActive(db, a.id, false);
    const r2 = await updateVehicle(db, v.id, { type: "CAR", plate: "ABC1D23", customerId: a.id });
    expect(r2).toMatchObject({ ok: false, error: MSG.customerInactive });
  });
  it("inativa e reativa; não cria/reativa com cliente inativo", async () => {
    const a = await customer("Ana");
    const v = await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    expect(await setVehicleActive(db, v.id, false)).toMatchObject({
      ok: true,
      data: { active: false },
    });
    expect(await setVehicleActive(db, v.id, true)).toMatchObject({
      ok: true,
      data: { active: true },
    });
    await setVehicleActive(db, v.id, false);
    await setCustomerActive(db, a.id, false);
    expect(await setVehicleActive(db, v.id, true)).toMatchObject({
      ok: false,
      error: MSG.customerInactive,
    });
    expect(await createVehicle(db, a.id, { type: "CAR" })).toMatchObject({
      ok: false,
      error: MSG.customerInactive,
    });
    expect(await setVehicleActive(db, 999, true)).toMatchObject({
      ok: false,
      error: MSG.vehicleNotFound,
    });
  });
  it("inativar cliente não apaga nem altera veículos", async () => {
    const a = await customer("Ana");
    await vehicle(a.id, { type: "CAR", plate: "ABC1D23" });
    await setCustomerActive(db, a.id, false);
    const d = await getCustomerDetail(db, a.id);
    expect(d).toMatchObject({ active: false });
    expect(d?.vehicles).toHaveLength(1);
  });
});
