import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/** Selo "Estoque baixo": âmbar claro sobre fundo translúcido (legível no tema escuro). */
export function LowStockBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300",
        className,
      )}
    >
      <TriangleAlert className="size-3" aria-hidden="true" />
      Estoque baixo
    </span>
  );
}

/** Quantidade atual em destaque (grande), vermelha se zerada e âmbar se baixa. */
export function StockQuantity({
  quantity,
  unit,
  low,
  size = "md",
}: {
  quantity: number;
  unit: string;
  low: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span
      data-testid="stock-quantity"
      className={cn(
        "font-semibold tabular-nums",
        size === "lg" ? "text-4xl" : "text-2xl",
        quantity === 0 ? "text-destructive" : low ? "text-amber-300" : "text-foreground",
      )}
    >
      {quantity}
      <span className="text-muted-foreground ml-1 text-sm font-normal">{unit}</span>
    </span>
  );
}
