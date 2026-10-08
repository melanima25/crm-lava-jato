/** Minúsculas, sem acentos/diacríticos e sem espaços nas pontas. "  JOÃO Ávila " -> "joao avila". */
export function foldText(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Mantém somente dígitos. "(11) 98765-4321" -> "11987654321". */
export function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}
