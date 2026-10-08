// Períodos do caixa em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019).
import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./period";

const at = (iso: string) => new Date(iso);
// 2026-10-01 é quinta-feira. 12:00 em São Paulo.
const THU = at("2026-10-01T15:00:00.000Z");

describe("resolvePeriod", () => {
  it("padrão e 'today': o dia de São Paulo, de 00:00:00.000 a 23:59:59.999", () => {
    for (const input of [undefined, {}, { preset: "today" as const }]) {
      const p = resolvePeriod(input, THU);
      expect(p.preset).toBe("today");
      expect([p.fromYmd, p.toYmd]).toEqual(["2026-10-01", "2026-10-01"]);
      expect(p.from.toISOString()).toBe("2026-10-01T03:00:00.000Z");
      expect(p.to.toISOString()).toBe("2026-10-02T02:59:59.999Z");
    }
  });

  it("23h30 de 30/09 em SP ainda é 30/09 (já é dia 1 em UTC); 00h30 de 01/10 é dia 1", () => {
    expect(resolvePeriod({}, at("2026-10-01T02:30:00.000Z")).toYmd).toBe("2026-09-30");
    expect(resolvePeriod({}, at("2026-10-01T03:30:00.000Z")).toYmd).toBe("2026-10-01");
  });

  it("semana: segunda a domingo da semana corrente", () => {
    const p = resolvePeriod({ preset: "week" }, THU);
    expect([p.fromYmd, p.toYmd]).toEqual(["2026-09-28", "2026-10-04"]);
    expect(p.from.toISOString()).toBe("2026-09-28T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-05T02:59:59.999Z");
    // domingo ainda é da semana que começou na segunda anterior
    expect(resolvePeriod({ preset: "week" }, at("2026-10-04T15:00:00.000Z")).fromYmd).toBe(
      "2026-09-28",
    );
    // segunda abre uma semana nova; 00h30 de segunda em SP (03h30 UTC) já conta
    expect(resolvePeriod({ preset: "week" }, at("2026-10-05T03:30:00.000Z")).fromYmd).toBe(
      "2026-10-05",
    );
    expect(resolvePeriod({ preset: "week" }, at("2026-10-05T02:30:00.000Z")).fromYmd).toBe(
      "2026-09-28",
    );
  });

  it("mês: do dia 1 ao último dia (inclui fevereiro bissexto)", () => {
    const p = resolvePeriod({ preset: "month" }, THU);
    expect([p.fromYmd, p.toYmd]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(p.to.toISOString()).toBe("2026-11-01T02:59:59.999Z");
    const feb = resolvePeriod({ preset: "month" }, at("2028-02-10T15:00:00.000Z"));
    expect([feb.fromYmd, feb.toYmd]).toEqual(["2028-02-01", "2028-02-29"]);
    // 00h30 de 1º de novembro em SP = 03h30 UTC: já é novembro
    expect(resolvePeriod({ preset: "month" }, at("2026-11-01T03:30:00.000Z")).fromYmd).toBe(
      "2026-11-01",
    );
    expect(resolvePeriod({ preset: "month" }, at("2026-11-01T02:30:00.000Z")).fromYmd).toBe(
      "2026-10-01",
    );
  });

  it("mês passado: mês civil anterior, inclusive na virada do ano e em fevereiro", () => {
    const p = resolvePeriod({ preset: "lastMonth" }, THU);
    expect([p.preset, p.fromYmd, p.toYmd]).toEqual(["lastMonth", "2026-09-01", "2026-09-30"]);
    expect(p.to.toISOString()).toBe("2026-10-01T02:59:59.999Z");
    const jan = resolvePeriod({ preset: "lastMonth" }, at("2027-01-10T15:00:00.000Z"));
    expect([jan.fromYmd, jan.toYmd]).toEqual(["2026-12-01", "2026-12-31"]);
    const mar = resolvePeriod({ preset: "lastMonth" }, at("2028-03-10T15:00:00.000Z"));
    expect([mar.fromYmd, mar.toYmd]).toEqual(["2028-02-01", "2028-02-29"]);
    // 00h30 de 1º/11 em SP já é novembro: mês passado = outubro
    expect(resolvePeriod({ preset: "lastMonth" }, at("2026-11-01T03:30:00.000Z")).fromYmd).toBe(
      "2026-10-01",
    );
  });

  it("personalizado: from/to; inverte se invertido; um só = dia único; inválido = hoje", () => {
    const c = resolvePeriod({ from: "2026-09-10", to: "2026-09-20" }, THU);
    expect(c.preset).toBe("custom");
    expect([c.fromYmd, c.toYmd]).toEqual(["2026-09-10", "2026-09-20"]);
    const inv = resolvePeriod({ from: "2026-09-20", to: "2026-09-10" }, THU);
    expect([inv.fromYmd, inv.toYmd]).toEqual(["2026-09-10", "2026-09-20"]);
    const one = resolvePeriod({ from: "2026-09-10" }, THU);
    expect([one.fromYmd, one.toYmd]).toEqual(["2026-09-10", "2026-09-10"]);
    const bad = resolvePeriod({ from: "2026-02-31", to: "lixo" }, THU);
    expect([bad.preset, bad.fromYmd]).toEqual(["today", "2026-10-01"]);
  });
});
