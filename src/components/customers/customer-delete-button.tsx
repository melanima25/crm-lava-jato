"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteCustomerAction } from "@/server/customers/actions";

/** Exclusão definitiva do cliente (só sem atendimentos). Se o servidor recusar, o erro fica no diálogo. */
export function CustomerDeleteButton({ customerId, name }: { customerId: number; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    const r = await deleteCustomerAction(customerId);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast.success("Cliente excluído");
    router.push("/clientes");
    router.refresh();
    return true;
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="text-destructive hover:text-destructive h-11 px-4"
        aria-label={`Excluir ${name}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Excluir cliente
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Excluir cliente?"
        description={`${name} será excluído definitivamente e não poderá ser recuperado. Os veículos cadastrados saem junto. Só é possível excluir um cliente que não tenha nenhum atendimento; caso contrário, use Inativar cliente.`}
        confirmLabel="Excluir definitivamente"
        pendingLabel="Excluindo..."
        destructive
        error={error}
        onConfirm={onConfirm}
      />
    </>
  );
}
