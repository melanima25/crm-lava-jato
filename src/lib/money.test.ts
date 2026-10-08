import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL } from "./money";

describe("parseBRL", () => {
  it.each([
    ["0,01", 1],
    ["0", 0],
    ["10", 1000],
    ["10,5", 1050],
    ["10,50", 1050],
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1.234", 123400],
    ["1.234.567,89", 123456789],
    ["R$ 1.234,56", 123456],
    ["R$1.234,56", 123456],
    ["  10,00  ", 1000],
    ["1 234,56", 123456],
    ["0,10", 10],
    ["19,90", 1990], // caso clássico de erro de float (19.9 * 100)
    ["1,15", 115],
    ["0,00", 0],
    ["1,5", 150],
    ["007,50", 750], // zeros à esquerda são aceitos
    ["r$ 10,00", 1000],
    ["1 234,56", 123456], // espaço não separável (NBSP)
    ["90071992547409,91", 9007199254740991], // exatamente Number.MAX_SAFE_INTEGER
  ])("converte %j em %d centavos", (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "R$",
    "abc",
    "1,234",
    "1.23",
    "10.50",
    "1..234,56",
    "1,2,3",
    ",50",
    "10,",
    "1e3",
    "--5",
    "+10",
    "0,001",
    "12.34,56", // milhar fora do padrão de 3 dígitos
    "1234.567,89", // grupo inicial com mais de 3 dígitos
    "1.234,5,6",
    "R$ R$ 10",
    "10 R$",
    "NaN",
    "Infinity",
    "0x10",
    "١٢٣", // dígitos não-ASCII
  ])("lança erro para %j", (input) => {
    expect(() => parseBRL(input)).toThrow();
  });

  it("rejeita negativo por padrão e aceita com allowNegative", () => {
    expect(() => parseBRL("-10,00")).toThrow(/negativo/);
    expect(parseBRL("-10,00", { allowNegative: true })).toBe(-1000);
    expect(parseBRL("-R$ 1,50", { allowNegative: true })).toBe(-150);
    expect(parseBRL("-0", { allowNegative: true })).toBe(0);
    expect(Object.is(parseBRL("-0,00", { allowNegative: true }), 0)).toBe(true); // nunca -0
    expect(() => parseBRL("-0,00")).toThrow(/negativo/);
    expect(() => parseBRL("- 5")).toThrow(/negativo/); // espaços são removidos antes do sinal
  });

  it("rejeita valores acima do inteiro seguro", () => {
    expect(() => parseBRL("999999999999999999,99")).toThrow();
    expect(() => parseBRL("90071992547409,92")).toThrow(/grande/); // MAX_SAFE_INTEGER + 1
  });

  it("lança erro para entrada não-string", () => {
    expect(() => parseBRL(undefined as unknown as string)).toThrow();
  });
});

describe("formatBRL", () => {
  it.each([
    [0, "R$ 0,00"],
    [1, "R$ 0,01"],
    [10, "R$ 0,10"],
    [1000, "R$ 10,00"],
    [123456, "R$ 1.234,56"],
    [123456789, "R$ 1.234.567,89"],
    [-150, "-R$ 1,50"],
    [-1, "-R$ 0,01"],
    [99, "R$ 0,99"],
    [100, "R$ 1,00"],
    [100000, "R$ 1.000,00"],
    [Number.MAX_SAFE_INTEGER, "R$ 90.071.992.547.409,91"],
  ])("formata %d como %j", (cents, expected) => {
    expect(formatBRL(cents)).toBe(expected);
  });

  it("lança erro para não inteiros", () => {
    expect(() => formatBRL(1.5)).toThrow();
    expect(() => formatBRL(Number.NaN)).toThrow();
    expect(() => formatBRL(Infinity)).toThrow();
    expect(() => formatBRL(2 ** 53)).toThrow();
    expect(() => formatBRL("100" as unknown as number)).toThrow();
  });

  it("formata -0 como zero, sem sinal", () => {
    expect(formatBRL(-0)).toBe("R$ 0,00");
  });

  it("é o inverso de parseBRL", () => {
    for (const cents of [0, 1, 99, 100, 101, 1990, 123456, 99999999, Number.MAX_SAFE_INTEGER]) {
      expect(parseBRL(formatBRL(cents))).toBe(cents);
    }
    expect(parseBRL(formatBRL(-12345), { allowNegative: true })).toBe(-12345);
  });
});
