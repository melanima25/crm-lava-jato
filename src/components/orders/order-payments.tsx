"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { formatDateTimeBR } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/order-ui";
import { formatBRL } from "@/lib/money";
import { deletePaymentAction } from "@/server/orders/actions";

export type PaymentView = {
  id: number;
  method: PaymentMethodValue;
  amountCents: number;
  occurredAt: Date;
};

/** Histórico de pagamentos com estorno (exclusão) após confirmação. */
export function OrderPayments({
  payments,
  canRefund,
}: {
  payments: PaymentView[];
  canRefund: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="sec-pagamentos" className="flex flex-col gap-3">
      <h2 id="sec-pagamentos" className="text-lg font-semibold">
        Pagamentos
      </h2>
      {payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum pagamento registrado.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Histórico de pagamentos">
          {payments.map((p) => (
            <li key={p.id} className="bg-card flex items-center gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{PAYMENT_METHOD_LABEL[p.method]}</p>
                <p className="text-muted-foreground text-sm">{formatDateTimeBR(p.occurredAt)}</p>
              </div>
              <Money cents={p.amountCents} className="font-semibold" />
              {canRefund && (
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11"
                  onClick={() => {
                    setError(null);
                    setTarget(p);
                  }}
                >
                  <Undo2 aria-hidden="true" />
                  <span className="sr-only">
                    Estornar pagamento de {formatBRL(p.amountCents)} em{" "}
                    {PAYMENT_METHOD_LABEL[p.method]}
                  </span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Estornar pagamento?"
        description={
          target
            ? `O pagamento de ${formatBRL(target.amountCents)} em ${PAYMENT_METHOD_LABEL[target.method]} será excluído: o valor sai do caixa e volta para o saldo do atendimento.`
            : ""
        }
        confirmLabel="Estornar"
        pendingLabel="Estornando..."
        destructive
        error={error}
        onConfirm={async () => {
          if (!target) return true;
          const r = await deletePaymentAction(target.id);
          if (!r.ok) {
            setError(r.error);
            return false;
          }
          toast.success("Pagamento estornado");
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}
