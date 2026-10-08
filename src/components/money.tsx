import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type MoneyProps = {
  /** Valor em centavos (inteiro). */
  cents: number;
  /** Destaca valores negativos em vermelho (ex.: saldo devedor). */
  highlightNegative?: boolean;
  className?: string;
};

/** Exibe centavos formatados em BRL ("R$ 1.234,56"). */
export function Money({ cents, highlightNegative = false, className }: MoneyProps) {
  return (
    <span
      className={cn(
        "tabular-nums",
        highlightNegative && cents < 0 && "text-destructive font-medium",
        className,
      )}
    >
      {formatBRL(cents)}
    </span>
  );
}
