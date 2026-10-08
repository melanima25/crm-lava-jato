import { normalizePlate } from "@/lib/plate";
import { onlyDigits } from "@/lib/text";

/** Máscara progressiva de telefone: "11987654321" -> "(11) 98765-4321". */
export function maskPhone(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (d.length <= 6) return `(${ddd}) ${rest}`;
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/** Telefone salvo (só dígitos) para exibição; vazio vira "". */
export function formatPhone(phone: string | null | undefined): string {
  return phone ? maskPhone(phone) : "";
}

/** Máscara de placa: maiúsculas, sem símbolos, hífen após 3 caracteres ("ABC-1D23"). */
export function maskPlate(input: string): string {
  const p = normalizePlate(input).slice(0, 7);
  return p.length > 3 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export function formatPlate(plate: string | null | undefined): string {
  return plate ? maskPlate(plate) : "";
}

export const VEHICLE_TYPE_LABEL = { CAR: "Carro", MOTORCYCLE: "Moto" } as const;
