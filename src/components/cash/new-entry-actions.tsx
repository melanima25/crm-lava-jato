"use client";

import { useState } from "react";
import Link from "next/link";
import { Landmark, Tags } from "lucide-react";

import { EntryFormDialog, type EntryFormSetup } from "@/components/cash/entry-form-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CashCategoryDTO } from "@/server/cash/queries";

/**
 * Atalhos de novo lançamento. "+ Despesa" é o principal: botão no topo no desktop e FAB acima da
 * barra inferior no celular (o main já reserva espaço embaixo).
 */
export function NewEntryActions({ categories }: { categories: CashCategoryDTO[] }) {
  const [setup, setSetup] = useState<EntryFormSetup | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="hidden h-11 md:inline-flex"
          onClick={() => setSetup({ mode: "create", direction: "OUT" })}
        >
          + Despesa
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 md:flex-none"
          onClick={() => setSetup({ mode: "create", direction: "IN" })}
        >
          + Entrada
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 md:flex-none"
          onClick={() =>
            setSetup({ mode: "create", direction: "IN", systemKey: "OPENING_BALANCE" })
          }
        >
          <Landmark aria-hidden="true" />
          Saldo inicial
        </Button>
        <Link
          href="/caixa/categorias"
          className={cn(buttonVariants({ variant: "ghost" }), "h-11 flex-1 md:flex-none")}
        >
          <Tags aria-hidden="true" />
          Categorias
        </Link>
      </div>

      <Button
        type="button"
        size="lg"
        onClick={() => setSetup({ mode: "create", direction: "OUT" })}
        className="bg-silver text-primary-foreground fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 h-14 rounded-full px-5 text-base font-semibold shadow-lg shadow-black/60 hover:opacity-90 md:hidden"
      >
        + Despesa
      </Button>

      <EntryFormDialog setup={setup} categories={categories} onClose={() => setSetup(null)} />
    </>
  );
}
