"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HandCoins } from "lucide-react";

import { ReceiveDialog, type ReceiveOrder } from "@/components/debt/receive-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Debt = {
  customerId: number;
  customerName: string;
  balanceCents: number;
  orders: ReceiveOrder[];
};

/** Botão "Receber" que abre o diálogo na própria tela (detalhe do cliente). */
export function ReceiveButton({
  debt,
  className,
  size = "default",
}: {
  debt: Debt;
  className?: string;
  size?: "default" | "lg";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size={size}
        className={cn("h-11 px-4", className)}
        onClick={() => setOpen(true)}
        aria-label={`Receber de ${debt.customerName}`}
      >
        <HandCoins aria-hidden="true" />
        Receber
      </Button>
      <ReceiveDialog
        open={open}
        onOpenChange={setOpen}
        customerId={debt.customerId}
        customerName={debt.customerName}
        balanceCents={debt.balanceCents}
        orders={debt.orders}
      />
    </>
  );
}

/**
 * "Receber" em cada linha de /fiado: a lista não carrega as pendências de todos os clientes, então o
 * clique grava `?receber=<id>` na URL e a página renderiza o diálogo com as pendências desse cliente.
 */
export function ReceiveRowButton({
  customerId,
  customerName,
  className,
}: {
  customerId: number;
  customerName: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Button
      type="button"
      className={cn("h-11 px-4", className)}
      aria-label={`Receber de ${customerName}`}
      onClick={() => {
        const next = new URLSearchParams(params.toString());
        next.set("receber", String(customerId));
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    >
      <HandCoins aria-hidden="true" />
      Receber
    </Button>
  );
}

/** Diálogo aberto por `?receber=<id>` em /fiado; fechar remove o parâmetro. */
export function ReceiveDialogHost({ debt }: { debt: Debt }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("receber");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  return (
    <ReceiveDialog
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
      customerId={debt.customerId}
      customerName={debt.customerName}
      balanceCents={debt.balanceCents}
      orders={debt.orders}
    />
  );
}
