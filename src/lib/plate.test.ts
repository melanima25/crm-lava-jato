import { describe, expect, it } from "vitest";
import { isValidPlate, normalizePlate, plateFormat } from "./plate";

describe("normalizePlate", () => {
  it.each([
    ["abc-1234", "ABC1234"],
    [" abc 1d23 ", "ABC1D23"],
    ["ABC1D23", "ABC1D23"],
    ["abc.1234", "ABC1234"],
    ["", ""],
  ])("normaliza %j para %j", (input, expected) => {
    expect(normalizePlate(input)).toBe(expected);
  });
});

describe("isValidPlate / plateFormat", () => {
  it.each(["ABC1234", "abc-1234", "ABC1D23", "abc 1d23"])("aceita %j", (p) => {
    expect(isValidPlate(p)).toBe(true);
  });

  it("identifica o padrão", () => {
    expect(plateFormat("ABC-1234")).toBe("old");
    expect(plateFormat("ABC1D23")).toBe("mercosul");
    expect(plateFormat("XYZ")).toBeNull();
  });

  it.each([
    "",
    "ABC123",
    "ABCD123",
    "AB1234",
    "ABC12345",
    "1234ABC",
    "ABC1DD3",
    "ABC12D3",
    "ABC-12-34-5",
  ])("rejeita %j", (p) => {
    expect(isValidPlate(p)).toBe(false);
  });
});
