// Rótulos e helpers de apresentação de atendimentos (sem regra de negócio).
import { formatPlate, VEHICLE_TYPE_LABEL } from "@/lib/format";

export type PaymentMethodValue = "CASH" | "PIX" | "DEBIT_CARD" | "CREDIT_CARD";

export const PAYMENT_METHODS: PaymentMethodValue[] = ["CASH", "PIX", "DEBIT_CARD", "CREDIT_CARD"];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethodValue, string> = {
  CASH: "Dinheiro",
  PIX: "Pix",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
};

export const STATUS_FILTER_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "OPEN", label: "Em andamento" },
  { value: "DONE", label: "Concluídos" },
  { value: "CANCELED", label: "Cancelados" },
] as const;

type BadgeInput = {
  status: "OPEN" | "DONE" | "CANCELED";
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | null;
};

/** Selo único: OS aberta/cancelada mostra o status; concluída mostra a situação do pagamento. */
export function orderBadge({ status, paymentStatus }: BadgeInput): {
  label: string;
  className: string;
} {
  if (status === "OPEN")
    return { label: "Em andamento", className: "bg-[#9aa3b2]/15 text-[#c9d0dc]" };
  if (status === "CANCELED")
    return { label: "Cancelado", className: "bg-muted text-muted-foreground" };
  if (paymentStatus === "PAID")
    return { label: "Pago", className: "bg-emerald-400/15 text-emerald-300" };
  if (paymentStatus === "PARTIAL")
    return { label: "Parcial", className: "bg-amber-400/15 text-amber-300" };
  return { label: "Não pago", className: "bg-red-400/15 text-red-300" };
}

type VehicleLike = {
  type: "CAR" | "MOTORCYCLE";
  plate: string | null;
  brand: string | null;
  model: string | null;
};

/** "ABC-1D23 · Gol" (placa e modelo quando houver; senão o tipo). */
export function vehicleLabel(v: VehicleLike | null | undefined): string {
  if (!v) return "Sem veículo";
  const model = [v.brand, v.model].filter(Boolean).join(" ");
  const parts = [formatPlate(v.plate), model].filter(Boolean);
  return parts.length ? parts.join(" · ") : `${VEHICLE_TYPE_LABEL[v.type]} sem placa`;
}
