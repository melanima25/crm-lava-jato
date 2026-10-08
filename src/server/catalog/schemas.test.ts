import { describe, expect, it } from "vitest";
import { NO_PRICE_MESSAGE, productInputSchema, serviceInputSchema } from "./schemas";

describe("serviceInputSchema", () => {
  it("aceita só preço de carro, só de moto ou ambos", () => {
    const car = serviceInputSchema.parse({ name: "Cera", carPriceCents: 5000 });
    expect(car).toMatchObject({ carPriceCents: 5000, motorcyclePriceCents: null });
    const moto = serviceInputSchema.parse({ name: "Cera", motorcyclePriceCents: 3000 });
    expect(moto).toMatchObject({ carPriceCents: null, motorcyclePriceCents: 3000 });
    expect(
      serviceInputSchema.safeParse({ name: "Cera", carPriceCents: 1, motorcyclePriceCents: 1 })
        .success,
    ).toBe(true);
  });

  it("trata vazio, null e undefined como não oferecido", () => {
    const r = serviceInputSchema.parse({
      name: "Cera",
      carPriceCents: 100,
      motorcyclePriceCents: "",
    });
    expect(r.motorcyclePriceCents).toBeNull();
  });

  it("exige ao menos um preço, com erro nos dois campos", () => {
    const r = serviceInputSchema.safeParse({
      name: "Cera",
      carPriceCents: "",
      motorcyclePriceCents: null,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(["carPriceCents", "motorcyclePriceCents"]);
      expect(r.error.issues[0].message).toBe(NO_PRICE_MESSAGE);
    }
  });

  it("rejeita preço negativo, zero, decimal e texto", () => {
    for (const bad of [-1, 0, 10.5, "abc", Number.NaN]) {
      const r = serviceInputSchema.safeParse({ name: "Cera", carPriceCents: bad });
      expect(r.success, String(bad)).toBe(false);
    }
  });

  it("valida o nome e apara a descrição", () => {
    expect(serviceInputSchema.safeParse({ name: " ", carPriceCents: 100 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ name: "A", carPriceCents: 100 }).success).toBe(false);
    const r = serviceInputSchema.parse({ name: "  Cera ", description: "  ", carPriceCents: 100 });
    expect(r).toMatchObject({ name: "Cera", description: null });
  });
});

describe("productInputSchema", () => {
  it("preço de venda é opcional e unidade padrão é un", () => {
    expect(productInputSchema.parse({ name: "Shampoo" })).toMatchObject({
      salePriceCents: null,
      unit: "un",
      description: null,
    });
    expect(productInputSchema.parse({ name: "Shampoo", unit: " ", salePriceCents: "" }).unit).toBe(
      "un",
    );
  });

  it("rejeita preço negativo/zero", () => {
    expect(productInputSchema.safeParse({ name: "Óleo", salePriceCents: -5 }).success).toBe(false);
    expect(productInputSchema.safeParse({ name: "Óleo", salePriceCents: 0 }).success).toBe(false);
    expect(productInputSchema.parse({ name: "Óleo", salePriceCents: 3500 }).salePriceCents).toBe(
      3500,
    );
  });
});
