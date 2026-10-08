"use client";

import { useState } from "react";
import { ClipboardCheck, Minus, Plus } from "lucide-react";

import { StockDialog, type StockDialogKind, type StockDialogProduct } from "./stock-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botões grandes "Entrada", "Baixa" e (opcional) "Acertar" que abrem os diálogos sem sair da página.
 * Produto inativo: entrada e baixa desabilitadas (o acerto continua permitido).
 */
export function StockQuickActions({
  product,
  active,
  showAdjust = false,
  large = false,
  initialKind = null,
  className,
}: {
  product: StockDialogProduct;
  active: boolean;
  showAdjust?: boolean;
  large?: boolean;
  /** Diálogo aberto ao carregar (ex.: atalho "Acertar inventário" vindo do atendimento). */
  initialKind?: StockDialogKind | null;
  className?: string;
}) {
  const [kind, setKind] = useState<StockDialogKind | null>(initialKind);
  const size = large ? "h-12 px-5 text-base" : "h-11 px-4";
  const blocked = active ? undefined : "Produto inativo: reative para movimentar";
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button
        type="button"
        className={cn(size, "flex-1 sm:flex-none")}
        disabled={!active}
        title={blocked}
        aria-label={`Entrada de ${product.name}`}
        onClick={() => setKind("in")}
      >
        <Plus aria-hidden="true" />
        Entrada
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn(size, "flex-1 sm:flex-none")}
        disabled={!active}
        title={blocked}
        aria-label={`Baixa de ${product.name}`}
        onClick={() => setKind("out")}
      >
        <Minus aria-hidden="true" />
        Baixa
      </Button>
      {showAdjust && (
        <Button
          type="button"
          variant="outline"
          className={cn(size, "flex-1 sm:flex-none")}
          aria-label={`Acertar inventário de ${product.name}`}
          onClick={() => setKind("adjust")}
        >
          <ClipboardCheck aria-hidden="true" />
          Acertar inventário
        </Button>
      )}
      {kind && (
        <StockDialog open onOpenChange={(o) => !o && setKind(null)} kind={kind} product={product} />
      )}
    </div>
  );
}
