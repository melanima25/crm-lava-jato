// Períodos do caixa em America/Sao_Paulo. Puro (sem banco): testável com `now` fixo.
// Limites: `from` = 00:00:00.000 do primeiro dia; `to` = 23:59:59.999 do último dia (INCLUSIVO).
// Consultas usam `gte from` e `lte to`.
import { addDaysYmd, endOfDayBR, parseDateBR, startOfDayBR, ymdBR } from "@/lib/dates";

export type PeriodPreset = "today" | "week" | "month" | "lastMonth" | "custom";

export type CashPeriodInput = {
  preset?: PeriodPreset;
  /** "yyyy-mm-dd" (dia em São Paulo). Com from/to informados o período é "custom". */
  from?: string;
  to?: string;
};

export type ResolvedPeriod = {
  preset: PeriodPreset;
  /** "yyyy-mm-dd" */
  fromYmd: string;
  toYmd: string;
  /** Instantes UTC; `to` inclusivo. */
  from: Date;
  to: Date;
};

function validYmd(s: string | undefined): s is string {
  if (!s) return false;
  try {
    parseDateBR(s);
    return true;
  } catch {
    return false;
  }
}

function build(preset: PeriodPreset, a: string, b: string): ResolvedPeriod {
  const [fromYmd, toYmd] = a <= b ? [a, b] : [b, a];
  return {
    preset,
    fromYmd,
    toYmd,
    from: startOfDayBR(parseDateBR(fromYmd)),
    to: endOfDayBR(parseDateBR(toYmd)),
  };
}

/**
 * Resolve o período. Padrão: hoje. "semana" = segunda a domingo da semana corrente; "mês" = dia 1
 * ao último dia do mês corrente. from/to válidos => personalizado (inverte se from > to; só um
 * deles informado vale como dia único). Datas inválidas caem em "hoje".
 */
export function resolvePeriod(input: CashPeriodInput = {}, now: Date = new Date()): ResolvedPeriod {
  const today = ymdBR(now);
  if (input.preset === "week" || input.preset === "month" || input.preset === "lastMonth") {
    const [y, m, d] = today.split("-").map(Number);
    if (input.preset === "week") {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
      const monday = addDaysYmd(today, -((dow + 6) % 7));
      return build("week", monday, addDaysYmd(monday, 6));
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    // "lastMonth" (E10): o mês civil anterior ao corrente.
    const [py, pm] = input.preset === "lastMonth" ? (m === 1 ? [y - 1, 12] : [y, m - 1]) : [y, m];
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return build(input.preset, `${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`);
  }
  if (input.preset !== "today" && (validYmd(input.from) || validYmd(input.to))) {
    const a = validYmd(input.from) ? input.from : (input.to as string);
    const b = validYmd(input.to) ? input.to : a;
    return build("custom", a, b);
  }
  return build("today", today, today);
}
