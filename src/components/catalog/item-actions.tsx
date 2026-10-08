"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, PowerOff, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  deleteProductAction,
  deleteServiceAction,
  setProductActiveAction,
  setServiceActiveAction,
} from "@/server/catalog/actions";
import { cn } from "@/lib/utils";

type Kind = "service" | "product";

const LABELS = {
  service: { base: "/servicos", singular: "serviço", article: "O", done: "Serviço" },
  product: { base: "/produtos", singular: "produto", article: "O", done: "Produto" },
} as const;

/**
 * Ações de um item do catálogo: Editar, Inativar/Reativar (reversível) e Excluir (definitivo).
 * `showEdit` = false na tela de edição. `compact` = botões menores para a lista.
 */
export function CatalogItemActions({
  kind,
  id,
  name,
  active,
  showEdit = true,
  className,
}: {
  kind: Kind;
  id: number;
  name: string;
  active: boolean;
  showEdit?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const t = LABELS[kind];
  const [toggleOpen, setToggleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onToggle() {
    const r =
      kind === "service"
        ? await setServiceActiveAction(id, !active)
        : await setProductActiveAction(id, !active);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(`${t.done} ${active ? "inativado" : "reativado"}`);
    router.refresh();
    return true;
  }

  async function onDelete() {
    const r = kind === "service" ? await deleteServiceAction(id) : await deleteProductAction(id);
    if (!r.ok) {
      // Ex.: item já usado — a mensagem do servidor sugere Inativar; mantém o diálogo aberto.
      setDeleteError(r.error);
      return false;
    }
    toast.success(`${t.done} excluído`);
    router.push(t.base);
    router.refresh();
    return true;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {showEdit && (
        <Link
          href={`${t.base}/${id}/editar`}
          aria-label={`Editar ${name}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 px-3")}
        >
          <Pencil aria-hidden="true" />
          Editar
        </Link>
      )}
      <Button
        type="button"
        variant="outline"
        className="h-11 px-3"
        aria-label={`${active ? "Inativar" : "Reativar"} ${name}`}
        onClick={() => setToggleOpen(true)}
      >
        {active ? <PowerOff aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        {active ? "Inativar" : "Reativar"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="text-destructive hover:text-destructive h-11 px-3"
        aria-label={`Excluir ${name}`}
        onClick={() => {
          setDeleteError(null);
          setDeleteOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Excluir
      </Button>

      <ConfirmDialog
        open={toggleOpen}
        onOpenChange={setToggleOpen}
        title={active ? `Inativar ${t.singular}?` : `Reativar ${t.singular}?`}
        description={
          active
            ? `${name} deixará de aparecer para novos atendimentos. Você pode reativar depois.`
            : `${name} voltará a aparecer para novos atendimentos.`
        }
        confirmLabel={active ? "Inativar" : "Reativar"}
        pendingLabel={active ? "Inativando..." : "Reativando..."}
        onConfirm={onToggle}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir ${t.singular}?`}
        description={`${name} será excluído definitivamente e não poderá ser recuperado. Se só quiser tirá-lo de uso, prefira Inativar.`}
        confirmLabel="Excluir definitivamente"
        pendingLabel="Excluindo..."
        destructive
        error={deleteError}
        onConfirm={onDelete}
      />
    </div>
  );
}
