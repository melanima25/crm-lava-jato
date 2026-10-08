"use client";

import { useState } from "react";
import { RotateCcw, UserX } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { setCustomerActiveAction } from "@/server/customers/actions";

export function CustomerActiveToggle({
  customerId,
  name,
  active,
}: {
  customerId: number;
  name: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);

  async function onConfirm() {
    const r = await setCustomerActiveAction(customerId, !active);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(active ? "Cliente inativado" : "Cliente reativado");
    return true;
  }

  return (
    <>
      <Button
        type="button"
        variant={active ? "destructive" : "outline"}
        className="h-11 px-4"
        onClick={() => setOpen(true)}
      >
        {active ? <UserX aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        {active ? "Inativar cliente" : "Reativar cliente"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={active ? "Inativar cliente?" : "Reativar cliente?"}
        description={
          active
            ? `${name} deixará de aparecer na busca padrão. O histórico é mantido e você pode reativar depois.`
            : `${name} voltará a aparecer na busca e poderá receber novos veículos.`
        }
        confirmLabel={active ? "Inativar" : "Reativar"}
        pendingLabel={active ? "Inativando..." : "Reativando..."}
        destructive={active}
        onConfirm={onConfirm}
      />
    </>
  );
}
