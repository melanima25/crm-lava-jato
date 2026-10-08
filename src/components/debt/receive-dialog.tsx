"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateBR, formatYmdBR, ymdBR } from "@/lib/dates";
import { previewDistribution } from "@/lib/debt-preview";
import { formatBRL } from "@/lib/money";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { receiveFromCustomerAction } from "@/server/orders/actions";

export type ReceiveOrder = { id: number; occurredAt: Date; balanceCents: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: number;
  customerName: string;
  /** Saldo devedor total (Σ saldos das pendências). */
  balanceCents: number;
  /** Pendências na ordem de distribuição (mais antiga -> mais nova). */
  orders: ReceiveOrder[];
  /** Chamado após um recebimento com sucesso (além do router.refresh). */
  onReceived?: () => void;
};

/**
 * Diálogo "Receber do cliente": valor (padrão = saldo total), forma (sem Fiado), data e prévia da
 * distribuição. A prévia é só visual; quem valida e distribui é o servidor.
 */
export function ReceiveDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        {/* Montado só enquanto aberto: o estado reinicia a cada abertura. */}
        <ReceiveForm {...rest} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** "yyyy-mm-dd" -> ISO com offset de São Paulo (-03:00); hoje = omitido (o servidor usa "agora"). */
function occurredAtOf(ymd: string): string | undefined {
  return ymd === ymdBR() ? undefined : `${ymd}T12:00:00-03:00`;
}

function ReceiveForm({
  customerId,
  customerName,
  balanceCents,
  orders,
  onReceived,
  onCancel,
}: Omit<Props, "open" | "onOpenChange"> & { onCancel: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState<number | null>(balanceCents);
  const [method, setMethod] = useState<PaymentMethodValue | null>(null);
  const [date, setDate] = useState(() => ymdBR());
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const today = ymdBR();

  const amountValid = amount !== null && !Number.isNaN(amount) && amount > 0;
  const tooHigh = amountValid && amount > balanceCents;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const canConfirm = amountValid && !tooHigh && method !== null && dateValid && balanceCents > 0;
  const lines = amountValid && !tooHigh ? previewDistribution(orders, amount) : [];

  function clearErrors() {
    setError(null);
    setFieldErrors({});
  }

  function confirm() {
    if (!canConfirm || amount === null || method === null) return;
    startTransition(async () => {
      const r = await receiveFromCustomerAction(customerId, {
        amountCents: amount,
        method,
        occurredAt: occurredAtOf(date),
      });
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
        return;
      }
      const n = r.data.distribution.length;
      const quitados = r.data.distribution.filter((d) => d.orderBalanceCents === 0).length;
      toast.success(
        `${formatBRL(r.data.receivedCents)} recebido de ${customerName} (${n === 1 ? "1 atendimento" : `${n} atendimentos`}, ${quitados === 1 ? "1 quitado" : `${quitados} quitados`}). ${
          r.data.balanceCents > 0
            ? `Saldo restante: ${formatBRL(r.data.balanceCents)}`
            : "Sem saldo devedor"
        }`,
      );
      onReceived?.();
      router.refresh();
      onCancel();
    });
  }

  const amountMessage =
    fieldErrors.amountCents ??
    (amount === null
      ? "Informe o valor"
      : amountValid
        ? tooHigh
          ? `O valor é maior que o saldo devedor (${formatBRL(balanceCents)})`
          : undefined
        : Number.isNaN(amount)
          ? "Valor inválido" // o MoneyInput troca pela mensagem específica do texto digitado
          : "Informe um valor maior que zero");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Receber do cliente</DialogTitle>
        <DialogDescription className="[overflow-wrap:anywhere]">
          <span className="text-foreground font-medium">{customerName}</span> deve{" "}
          <Money cents={balanceCents} className="text-destructive text-base font-semibold" />
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="receive-amount">Valor a receber</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-3"
            disabled={pending || amount === balanceCents}
            onClick={() => {
              setAmount(balanceCents);
              clearErrors();
            }}
          >
            Total
          </Button>
        </div>
        <MoneyInput
          id="receive-amount"
          value={amount}
          onChange={(c) => {
            setAmount(c);
            clearErrors();
          }}
          error={amountMessage}
          disabled={pending}
          className="h-12 text-lg"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="receive-method-label" className="text-sm leading-none font-medium">
          Forma de pagamento
        </span>
        <div role="group" aria-labelledby="receive-method-label" className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              disabled={pending}
              onClick={() => {
                setMethod(m);
                clearErrors();
              }}
              className={cn(
                "focus-visible:ring-ring/50 min-h-14 rounded-xl border-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
                method === m
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {PAYMENT_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {fieldErrors.method && (
          <p role="alert" className="text-destructive text-sm">
            {fieldErrors.method}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-date">Data do recebimento</Label>
        <Input
          id="receive-date"
          type="date"
          value={date}
          max={today}
          disabled={pending}
          onChange={(e) => {
            setDate(e.target.value);
            clearErrors();
          }}
          aria-invalid={!dateValid || fieldErrors.occurredAt ? true : undefined}
          className="h-12 text-base"
        />
        {(fieldErrors.occurredAt || !dateValid) && (
          <p role="alert" className="text-destructive text-sm">
            {fieldErrors.occurredAt ?? "Informe uma data válida (não pode ser futura)"}
          </p>
        )}
      </div>

      {lines.length > 0 && (
        <section
          aria-label="Como será distribuído"
          data-testid="receive-preview"
          className="bg-muted/60 flex flex-col gap-1.5 rounded-lg border p-3"
        >
          <h3 className="text-sm font-semibold">Como será distribuído</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {lines.map((l) => (
              <li key={l.orderId} className="[overflow-wrap:anywhere]">
                Atendimento #{l.orderId} de {formatDateBR(l.occurredAt)} —{" "}
                {l.remainingCents === 0 ? (
                  <>
                    quita <Money cents={l.amountCents} className="font-semibold" />
                  </>
                ) : (
                  <>
                    recebe <Money cents={l.amountCents} className="font-semibold" />, restam{" "}
                    <Money cents={l.remainingCents} className="font-semibold" />
                  </>
                )}
              </li>
            ))}
          </ul>
          {amountValid && (
            <p className="text-muted-foreground text-xs">
              Saldo do cliente depois: <Money cents={balanceCents - amount} />
              {" · "}Data: {formatYmdBR(dateValid ? date : today)}
            </p>
          )}
        </section>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={pending}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-12 text-base"
          disabled={!canConfirm || pending}
          onClick={confirm}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending
            ? "Recebendo..."
            : amountValid && !tooHigh
              ? `Receber ${formatBRL(amount)}`
              : "Receber"}
        </Button>
      </DialogFooter>
    </>
  );
}
