import { describe, expect, it } from "vitest";
import { foldText, onlyDigits } from "./text";

describe("foldText", () => {
  it("remove acentos, caixa e espaços extras", () => {
    expect(foldText("  JOÃO   Ávila ")).toBe("joao avila");
    expect(foldText("Conceição Çé")).toBe("conceicao ce");
  });
});

describe("onlyDigits", () => {
  it("mantém só dígitos", () => {
    expect(onlyDigits("(11) 98765-4321")).toBe("11987654321");
    expect(onlyDigits("abc")).toBe("");
  });
});
