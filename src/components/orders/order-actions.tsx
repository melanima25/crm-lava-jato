"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, Loader2, Pencil, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MoneyInput } from "@/components/money-input";
import {
  PaymentDialog,
  type PaymentLine,
  type PaymentSubmitResult,
} from "@/components/orders/payment-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelOrderAction,
  completeOrderAction,
  deleteOrderAction,
  registerPaymentAction,
  updateOrderAction,
} from "@/server/orders/actions";

type Status = "OPEN" | "DONE" | "CANCELED";

/** Ações do atendimento: Concluir, Registrar pagamento, Editar desconto/observação, Cancelar. */
export function OrderActions({
  orderId,
  status,
  totalCents,
  balanceCents,
  subtotalCents,
  discountCents,
  notes,
  hasItems,
}: {
  orderId: number;
  status: Status;
  totalCents: number;
  balanceCents: number;
  subtotalCents: number;
  discountCents: number;
  notes: string | null;
  hasItems: boolean;
}) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [extras, setExtras] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function complete(payments: PaymentLine[]): Promise<PaymentSubmitResult> {
    const r = await completeOrderAction(orderId, payments);
    if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
    toast.success(
      payments.length === 0 ? "Atendimento concluído no fiado" : "Atendimento concluído",
    );
    setCompleting(false);
    router.refresh();
    return { ok: true };
  }

  async function registerPayments(payments: PaymentLine[]): Promise<PaymentSubmitResult> {
    // O servidor recebe uma forma por vez; se uma falhar, as anteriores já estão gravadas.
    for (let i = 0; i < payments.length; i++) {
      const r = await registerPaymentAction(orderId, payments[i]);
      if (!r.ok) {
        if (i > 0) {
          toast.error(`${r.error} (${i} pagamento(s) já registrado(s))`);
          setPaying(false);
          router.refresh();
          return { ok: true };
        }
        const fe: Record<string, string> = {};
        if (r.fieldErrors?.amountCents) fe["payments.0.amountCents"] = r.fieldErrors.amountCents;
        return { ok: false, error: r.error, fieldErrors: fe };
      }
    }
    toast.success("Pagamento registrado");
    setPaying(false);
    router.refresh();
    return { ok: true };
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "OPEN" && (
        <Button
          type="button"
          className="h-12 flex-1 px-5 text-base sm:flex-none"
          disabled={!hasItems}
          onClick={() => setCompleting(true)}
        >
          <CheckCircle2 aria-hidden="true" />
          Concluir
        </Button>
      )}
      {status === "DONE" && balanceCents > 0 && (
        <Button
          type="button"
          className="h-12 flex-1 px-5 text-base sm:flex-none"
          onClick={() => setPaying(true)}
        >
          <Banknote aria-hidden="true" />
          Registrar pagamento
        </Button>
      )}
      {status !== "CANCELED" && (
        <>
          <Button
            type="button"
            variant="outline"
            className="h-12 px-4"
            onClick={() => setExtras(true)}
          >
            <Pencil aria-hidden="true" />
            Desconto e observação
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-12 px-4"
            onClick={() => {
              setCancelError(null);
              setCanceling(true);
            }}
          >
            <XCircle aria-hidden="true" />
            Cancelar atendimento
          </Button>
        </>
      )}
      {status === "CANCELED" && (
        <Button
          type="button"
          variant="outline"
          className="text-destructive hover:text-destructive h-12 px-4"
          aria-label={`Excluir atendimento #${orderId}`}
          onClick={() => {
            setDeleteError(null);
            setDeleting(true);
          }}
        >
          <Trash2 aria-hidden="true" />
          Excluir atendimento
        </Button>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir atendimento?"
        description="O atendimento cancelado e todos os seus itens serão excluídos definitivamente e não poderão ser recuperados. Isso não afeta o caixa nem o estoque."
        confirmLabel="Excluir definitivamente"
        pendingLabel="Excluindo..."
        destructive
        error={deleteError}
        onConfirm={async () => {
          const r = await deleteOrderAction(orderId);
          if (!r.ok) {
            setDeleteError(r.error);
            return false;
          }
          toast.success("Atendimento excluído");
          router.push("/atendimentos");
          router.refresh();
          return true;
        }}
      />

      <PaymentDialog
        open={completing}
        onOpenChange={setCompleting}
        totalCents={totalCents}
        allowFiado
        title="Concluir e receber"
        confirmLabel="Concluir e receber"
        onSubmit={complete}
      />
      <PaymentDialog
        open={paying}
        onOpenChange={setPaying}
        totalCents={balanceCents}
        allowFiado={false}
        title="Registrar pagamento"
        confirmLabel="Registrar pagamento"
        onSubmit={registerPayments}
      />

      <Dialog open={extras} onOpenChange={setExtras}>
        <DialogContent>
          {extras && (
            <ExtrasForm
              orderId={orderId}
              subtotalCents={subtotalCents}
              discountCents={discountCents}
              notes={notes}
              onDone={() => {
                setExtras(false);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={canceling}
        onOpenChange={setCanceling}
        title="Cancelar atendimento?"
        description="O atendimento ficará cancelado e não poderá mais ser alterado. Produtos vendidos voltam ao estoque. Atendimentos com pagamentos só podem ser cancelados depois de estornar os pagamentos."
        confirmLabel="Cancelar atendimento"
        pendingLabel="Cancelando..."
        destructive
        error={cancelError}
        onConfirm={async () => {
          const r = await cancelOrderAction(orderId);
          if (!r.ok) {
            setCancelError(r.error);
            return false;
          }
          toast.success("Atendimento cancelado");
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}

function ExtrasForm({
  orderId,
  subtotalCents,
  discountCents,
  notes,
  onDone,
}: {
  orderId: number;
  subtotalCents: number;
  discountCents: number;
  notes: string | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [discount, setDiscount] = useState<number | null>(discountCents);
  const [text, setText] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [discountError, setDiscountError] = useState<string | undefined>();

  const validDiscount = discount === null || (!Number.isNaN(discount) && discount >= 0);
  const tooHigh = discount !== null && !Number.isNaN(discount) && discount > subtotalCents;

  function save() {
    startTransition(async () => {
      const r = await updateOrderAction(orderId, { discountCents: discount ?? 0, notes: text });
      if (!r.ok) {
        setDiscountError(r.fieldErrors?.discountCents);
        setError(r.error);
        return;
      }
      toast.success("Atendimento atualizado");
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Desconto e observação</DialogTitle>
        <DialogDescription>O total é recalculado ao salvar.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-discount">Desconto</Label>
          <MoneyInput
            id="edit-discount"
            value={discount}
            onChange={(c) => {
              setDiscount(c);
              setError(null);
              setDiscountError(undefined);
            }}
            error={
              discountError ??
              (tooHigh ? "O desconto não pode ser maior que o subtotal" : undefined)
            }
            disabled={pending}
            className="h-11 text-base"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-notes">Observação</Label>
          <Textarea
            id="edit-notes"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={1000}
            disabled={pending}
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          className="h-12 text-base"
          disabled={pending || !validDiscount || tooHigh}
          onClick={save}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}
