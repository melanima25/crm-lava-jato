/**
 * Dinheiro sempre em centavos (inteiro). Nenhuma conversão usa float:
 * o texto é decomposto em dígitos e montado como string antes de virar Number.
 */

// Formato pt-BR: "1.234,56", "1234,56", "10", "0,01", "10,5" (ponto só como milhar, de 3 em 3 dígitos).
const BRL_PATTERN = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export type ParseBRLOptions = {
  /** Aceita valores negativos (padrão: false — campos de valor nunca são negativos). */
  allowNegative?: boolean;
};

/**
 * Converte texto em BRL para centavos.
 * Aceita "R$", espaços e (opcionalmente) sinal negativo.
 * Lança Error para vazio, inválido, negativo (sem allowNegative) ou fora do intervalo seguro.
 */
export function parseBRL(input: string, options: ParseBRLOptions = {}): number {
  if (typeof input !== "string") throw new Error("Valor inválido.");

  let text = input.replace(/\s+/g, "").replace(/^(-?)R\$/i, "$1");
  if (text === "") throw new Error("Informe um valor.");

  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }

  const match = BRL_PATTERN.exec(text);
  if (!match) throw new Error("Valor inválido.");

  if (negative && !options.allowNegative) throw new Error("O valor não pode ser negativo.");

  const reais = match[1].replaceAll(".", "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  const total = Number(reais + cents);
  if (!Number.isSafeInteger(total)) throw new Error("Valor grande demais.");

  return negative && total !== 0 ? -total : total;
}

/** Formata centavos como "R$ 1.234,56" (espaço comum, sem Intl/float). */
export function formatBRL(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Centavos devem ser um inteiro.");

  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = (abs % 100).toString().padStart(2, "0");

  return `${cents < 0 ? "-" : ""}R$ ${reais},${centavos}`;
}
