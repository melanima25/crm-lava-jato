"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Search } from "lucide-react";

import { Money } from "@/components/money";
import { Input } from "@/components/ui/input";
import { foldText } from "@/lib/text";
import { cn } from "@/lib/utils";

export type ProductOption = {
  id: number;
  name: string;
  unit: string;
  salePriceCents: number;
  stockQuantity: number;
};

/** Grade de produtos à venda (E9) com o estoque atual. `counts` mostra a quantidade já adicionada. */
export function ProductTiles({
  products,
  counts = {},
  onPick,
  disabled = false,
}: {
  products: ProductOption[];
  counts?: Record<number, number>;
  onPick: (product: ProductOption) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = foldText(q).trim();
  const shown = needle ? products.filter((p) => foldText(p.name).includes(needle)) : products;

  return (
    <div className="flex flex-col gap-3">
      {products.length > 6 && (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label="Filtrar produtos"
            placeholder="Filtrar produtos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-9 text-base [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum produto encontrado.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Produtos à venda">
          {shown.map((p) => {
            const n = counts[p.id] ?? 0;
            const short = p.stockQuantity < Math.max(n, 1);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(p)}
                  aria-label={`Adicionar ${p.name}`}
                  className={cn(
                    "focus-visible:ring-ring/50 relative flex min-h-16 w-full flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left outline-none focus-visible:ring-3 disabled:opacity-50",
                    n > 0 ? "border-primary bg-primary/5" : "bg-background hover:bg-muted",
                  )}
                >
                  <span className="pr-6 text-sm leading-tight font-medium [overflow-wrap:anywhere]">
                    {p.name}
                  </span>
                  <Money cents={p.salePriceCents} className="text-muted-foreground text-sm" />
                  <span
                    className={cn("text-xs", short ? "text-destructive" : "text-muted-foreground")}
                  >
                    Estoque: {p.stockQuantity} {p.unit}
                  </span>
                  {n > 0 && (
                    <span
                      aria-hidden="true"
                      className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full text-xs font-semibold"
                    >
                      {n}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Id do produto quando o erro do servidor foi de estoque insuficiente (`fieldErrors.stockProductId`). */
export function stockProductIdOf(fieldErrors?: Record<string, string>): number | null {
  const id = Number(fieldErrors?.stockProductId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Endereço do atalho "Acertar inventário" (abre o acerto na página de estoque do produto). */
export function adjustStockHref(productId: number) {
  return `/estoque/${productId}?acertar=1`;
}

/** Atalho exibido junto da mensagem de estoque insuficiente. */
export function AdjustStockLink({ productId }: { productId: number }) {
  return (
    <Link
      href={adjustStockHref(productId)}
      className="text-primary inline-flex min-h-11 items-center gap-1.5 text-sm font-medium hover:underline"
    >
      <ClipboardCheck className="size-4" aria-hidden="true" />
      Acertar inventário
    </Link>
  );
}
