import { describe, expect, it } from "vitest";
import { customerInputSchema, vehicleInputSchema } from "./schemas";

describe("customerInputSchema", () => {
  it("exige nome", () => {
    expect(customerInputSchema.safeParse({}).success).toBe(false);
    expect(customerInputSchema.safeParse({ name: " " }).success).toBe(false);
    expect(customerInputSchema.safeParse({ name: "A" }).success).toBe(false);
  });
  it("aceita só nome; opcionais viram null", () => {
    expect(customerInputSchema.parse({ name: "  Maria  " })).toEqual({
      name: "Maria",
      phone: null,
      notes: null,
    });
    expect(customerInputSchema.parse({ name: "Maria", phone: "", notes: "  " })).toEqual({
      name: "Maria",
      phone: null,
      notes: null,
    });
  });
  it("salva telefone só com dígitos", () => {
    expect(customerInputSchema.parse({ name: "Ana", phone: "(11) 98765-4321" }).phone).toBe(
      "11987654321",
    );
  });
  it("rejeita telefone com dígitos demais ou de menos", () => {
    expect(customerInputSchema.safeParse({ name: "Ana", phone: "123" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ name: "Ana", phone: "1".repeat(14) }).success).toBe(
      false,
    );
  });
  it("limita tamanhos", () => {
    expect(customerInputSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
    expect(customerInputSchema.safeParse({ name: "Ana", notes: "x".repeat(1001) }).success).toBe(
      false,
    );
  });
});

describe("vehicleInputSchema", () => {
  it("exige tipo", () => {
    expect(vehicleInputSchema.safeParse({}).success).toBe(false);
    expect(vehicleInputSchema.safeParse({ type: "TRUCK" }).success).toBe(false);
  });
  it("placa opcional", () => {
    expect(vehicleInputSchema.parse({ type: "CAR" }).plate).toBeNull();
    expect(vehicleInputSchema.parse({ type: "CAR", plate: "" }).plate).toBeNull();
  });
  it("normaliza placa Mercosul e antiga", () => {
    expect(vehicleInputSchema.parse({ type: "CAR", plate: "abc-1d23" }).plate).toBe("ABC1D23");
    expect(vehicleInputSchema.parse({ type: "MOTORCYCLE", plate: "abc 1234" }).plate).toBe(
      "ABC1234",
    );
  });
  it("rejeita placa inválida", () => {
    const r = vehicleInputSchema.safeParse({ type: "CAR", plate: "AB-123" });
    expect(r.success).toBe(false);
  });
  it("campos opcionais vazios viram null", () => {
    const v = vehicleInputSchema.parse({ type: "CAR", brand: " Fiat ", model: "", color: null });
    expect(v).toMatchObject({ brand: "Fiat", model: null, color: null, notes: null });
  });
});
