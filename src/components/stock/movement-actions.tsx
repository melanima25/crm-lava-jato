"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StockDialog, type EditableMovement, type StockDialogProduct } from "./stock-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/money";
import { deleteStockMovementAction } from "@/server/stock/actions";

/** Editar/Excluir de uma movimentação manual (só renderizado quando `editable`). */
export function MovementActions({
  product,
  movement,
}: {
  product: StockDialogProduct;
  movement: EditableMovement;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const purchase = movement.cashEntry;

  async function onDelete() {
    setDeleteError(null);
    const r = await deleteStockMovementAction(movement.id);
    if (!r.ok) {
      setDeleteError(r.error);
      return false;
    }
    toast.success(
      r.data.removedCashEntryId
        ? `Movimentação excluída e compra removida do caixa. Estoque atual: ${r.data.stockQuantity}`
        : `Movimentação excluída. Estoque atual: ${r.data.stockQuantity}`,
    );
    router.refresh();
    return true;
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 px-3"
        aria-label="Editar movimentação"
        onClick={() => setEditOpen(true)}
      >
        <Pencil aria-hidden="true" />
        Editar
      </Button>
      <Button
        type="button"
        variant="outline"
        className="text-destructive h-11 px-3"
        aria-label="Excluir movimentação"
        onClick={() => {
          setDeleteError(null);
          setDeleteOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Excluir
      </Button>
      {editOpen && (
        <StockDialog
          open
          onOpenChange={(o) => !o && setEditOpen(false)}
          kind="edit"
          product={product}
          movement={movement}
        />
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir movimentação?"
        description={
          purchase
            ? `Esta entrada tem uma compra de ${formatBRL(purchase.amountCents)} lançada no caixa. Ao excluir, a despesa também será removida do caixa e o estoque será recalculado.`
            : "O estoque será recalculado sem esta movimentação. Esta ação não pode ser desfeita."
        }
        confirmLabel="Excluir"
        pendingLabel="Excluindo..."
        destructive
        error={deleteError}
        onConfirm={onDelete}
      />
    </div>
  );
}
