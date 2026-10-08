"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { Money } from "@/components/money";
import { Input } from "@/components/ui/input";
import { foldText } from "@/lib/text";
import { cn } from "@/lib/utils";

export type ServiceOption = { id: number; name: string; suggestedPriceCents: number };

/** Grade de serviços para tocar e adicionar. `counts` mostra a quantidade já adicionada. */
export function ServiceTiles({
  services,
  counts = {},
  onPick,
  disabled = false,
}: {
  services: ServiceOption[];
  counts?: Record<number, number>;
  onPick: (service: ServiceOption) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = foldText(q).trim();
  const shown = needle ? services.filter((s) => foldText(s.name).includes(needle)) : services;

  return (
    <div className="flex flex-col gap-3">
      {services.length > 6 && (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label="Filtrar serviços"
            placeholder="Filtrar serviços"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-9 text-base [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum serviço encontrado.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Serviços oferecidos">
          {shown.map((s) => {
            const n = counts[s.id] ?? 0;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(s)}
                  aria-label={`Adicionar ${s.name}`}
                  className={cn(
                    "focus-visible:ring-ring/50 relative flex min-h-16 w-full flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left outline-none focus-visible:ring-3 disabled:opacity-50",
                    n > 0 ? "border-primary bg-primary/5" : "bg-background hover:bg-muted",
                  )}
                >
                  <span className="pr-6 text-sm leading-tight font-medium [overflow-wrap:anywhere]">
                    {s.name}
                  </span>
                  <Money cents={s.suggestedPriceCents} className="text-muted-foreground text-sm" />
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
