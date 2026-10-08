/**
 * Datas são armazenadas em UTC; "dia" e "mês" de negócio são os de America/Sao_Paulo.
 * Todas as funções retornam instantes (Date, UTC). Os limites "fim" são INCLUSIVOS
 * (23:59:59.999 local) — use `gte start` e `lte end` nas consultas.
 */
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import { tz, TZDate } from "@date-fns/tz";

export const APP_TIME_ZONE = "America/Sao_Paulo";

const opts = { in: tz(APP_TIME_ZONE) };

export function startOfDayBR(date: Date | number = new Date()): Date {
  return new Date(startOfDay(date, opts).getTime());
}

export function endOfDayBR(date: Date | number = new Date()): Date {
  return new Date(endOfDay(date, opts).getTime());
}

export function startOfMonthBR(date: Date | number = new Date()): Date {
  return new Date(startOfMonth(date, opts).getTime());
}

export function endOfMonthBR(date: Date | number = new Date()): Date {
  return new Date(endOfMonth(date, opts).getTime());
}

/**
 * Converte "yyyy-mm-dd" (ex.: de <input type="date">) no início desse dia em São Paulo.
 * Lança Error se o texto não for uma data de calendário válida.
 */
export function parseDateBR(isoDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error("Data inválida.");
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const local = new TZDate(year, month - 1, day, APP_TIME_ZONE);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
    throw new Error("Data inválida.");
  }
  return new Date(local.getTime());
}

/** Formata um instante como "dd/MM/yyyy" no fuso de São Paulo. */
export function formatDateBR(date: Date | number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Formata um instante como "dd/MM/yyyy HH:mm" no fuso de São Paulo. */
export function formatDateTimeBR(date: Date | number): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

/** "yyyy-mm-dd" do dia (em São Paulo) de um instante; padrão: hoje. */
export function ymdBR(date: Date | number = new Date()): string {
  // en-CA formata como yyyy-mm-dd
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Valida "yyyy-mm-dd" de calendário; qualquer outra coisa (ou ausente) vira hoje. */
export function ymdOrToday(value: string | undefined): string {
  if (value) {
    try {
      parseDateBR(value);
      return value;
    } catch {
      // cai em hoje
    }
  }
  return ymdBR();
}

/** Soma dias a um "yyyy-mm-dd" (aritmética de calendário, sem fuso). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "yyyy-mm-dd" -> "dd/mm/aaaa" (sem conversão de fuso). */
export function formatYmdBR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** Formata um instante como "HH:mm" no fuso de São Paulo. */
export function formatTimeBR(date: Date | number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "yyyy-MM-ddTHH:mm" (valor de <input type="datetime-local">) de um instante, no fuso de São Paulo. */
export function toDateTimeLocalBR(date: Date | number = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}

/**
 * "yyyy-MM-ddTHH:mm" (horário de São Paulo) -> ISO com offset -03:00 (sem horário de verão desde 2019).
 * Devolve null se o texto não for uma data/hora válida.
 */
export function dateTimeLocalBRToIso(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  try {
    parseDateBR(m[1]);
  } catch {
    return null;
  }
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return `${value}:00-03:00`;
}
