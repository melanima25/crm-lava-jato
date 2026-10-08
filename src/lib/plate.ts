/** Placas brasileiras: padrão antigo (ABC1234) e Mercosul (ABC1D23). */

const OLD_PATTERN = /^[A-Z]{3}\d{4}$/;
const MERCOSUL_PATTERN = /^[A-Z]{3}\d[A-Z]\d{2}$/;

/** Maiúsculas, sem hífen, espaços ou outros separadores. "abc-1d23" -> "ABC1D23". */
export function normalizePlate(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** Valida (após normalizar) os padrões antigo ou Mercosul. */
export function isValidPlate(input: string): boolean {
  const plate = normalizePlate(input);
  return OLD_PATTERN.test(plate) || MERCOSUL_PATTERN.test(plate);
}

/** Retorna o tipo do padrão ou null se inválida. */
export function plateFormat(input: string): "old" | "mercosul" | null {
  const plate = normalizePlate(input);
  if (OLD_PATTERN.test(plate)) return "old";
  if (MERCOSUL_PATTERN.test(plate)) return "mercosul";
  return null;
}
