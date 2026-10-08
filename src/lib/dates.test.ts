import { describe, expect, it } from "vitest";
import {
  endOfDayBR,
  endOfMonthBR,
  formatDateBR,
  formatDateTimeBR,
  dateTimeLocalBRToIso,
  parseDateBR,
  startOfDayBR,
  startOfMonthBR,
  toDateTimeLocalBR,
} from "./dates";

// São Paulo = UTC-3 (sem horário de verão desde 2019).
describe("dia em America/Sao_Paulo", () => {
  it("início do dia: 15/03 12:00 UTC -> 15/03 03:00 UTC", () => {
    expect(startOfDayBR(new Date("2026-03-15T12:00:00Z")).toISOString()).toBe(
      "2026-03-15T03:00:00.000Z",
    );
  });

  it("fim do dia: 15/03 12:00 UTC -> 16/03 02:59:59.999 UTC", () => {
    expect(endOfDayBR(new Date("2026-03-15T12:00:00Z")).toISOString()).toBe(
      "2026-03-16T02:59:59.999Z",
    );
  });

  it("instante 02:00 UTC ainda é o dia anterior em São Paulo", () => {
    const d = new Date("2026-03-16T02:00:00Z"); // 15/03 23:00 local
    expect(startOfDayBR(d).toISOString()).toBe("2026-03-15T03:00:00.000Z");
    expect(endOfDayBR(d).toISOString()).toBe("2026-03-16T02:59:59.999Z");
  });

  it("instante 03:00 UTC já é o dia seguinte em São Paulo", () => {
    expect(startOfDayBR(new Date("2026-03-16T03:00:00Z")).toISOString()).toBe(
      "2026-03-16T03:00:00.000Z",
    );
  });
});

describe("mês em America/Sao_Paulo", () => {
  it("início e fim de março", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    expect(startOfMonthBR(d).toISOString()).toBe("2026-03-01T03:00:00.000Z");
    expect(endOfMonthBR(d).toISOString()).toBe("2026-04-01T02:59:59.999Z");
  });

  it("virada de mês: 01/04 01:00 UTC ainda é março local", () => {
    const d = new Date("2026-04-01T01:00:00Z"); // 31/03 22:00 local
    expect(startOfMonthBR(d).toISOString()).toBe("2026-03-01T03:00:00.000Z");
    expect(endOfMonthBR(d).toISOString()).toBe("2026-04-01T02:59:59.999Z");
  });

  it("fevereiro de ano bissexto", () => {
    const d = new Date("2028-02-10T12:00:00Z");
    expect(endOfMonthBR(d).toISOString()).toBe("2028-03-01T02:59:59.999Z");
  });
});

describe("parseDateBR", () => {
  it("converte yyyy-mm-dd no início do dia local", () => {
    expect(parseDateBR("2026-03-15").toISOString()).toBe("2026-03-15T03:00:00.000Z");
  });

  it.each(["", "15/03/2026", "2026-13-01", "2026-02-30", "2026-3-5"])("rejeita %j", (s) => {
    expect(() => parseDateBR(s)).toThrow();
  });
});

describe("formatação", () => {
  it("formata no fuso de São Paulo", () => {
    const d = new Date("2026-03-16T02:30:00Z"); // 15/03 23:30 local
    expect(formatDateBR(d)).toBe("15/03/2026");
    expect(formatDateTimeBR(d)).toBe("15/03/2026 23:30");
  });
});

describe("datetime-local (São Paulo)", () => {
  it("converte instante <-> valor do input e ISO com offset", () => {
    const d = new Date("2026-03-16T02:30:00Z"); // 15/03 23:30 local
    expect(toDateTimeLocalBR(d)).toBe("2026-03-15T23:30");
    expect(dateTimeLocalBRToIso("2026-03-15T23:30")).toBe("2026-03-15T23:30:00-03:00");
    expect(new Date(dateTimeLocalBRToIso("2026-03-15T23:30")!).getTime()).toBe(d.getTime());
  });

  it.each(["", "2026-02-30T10:00", "2026-03-15", "2026-03-15T24:00"])("rejeita %j", (s) => {
    expect(dateTimeLocalBRToIso(s)).toBeNull();
  });
});
