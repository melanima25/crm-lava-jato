"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import { AdjustStockLink, stockProductIdOf } from "@/components/orders/product-tiles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/order-ui";
import { cn } from "@/lib/utils";

export type PaymentLine = { method: PaymentMethodValue; amountCents: number };

export type PaymentSubmitResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

type Line = { key: number; method: PaymentMethodValue; cents: number | null };

const MAX_LINES = 6;

/**
 * Diálogo de pagamento. Com `allowFiado` (conclusão) oferece "Fiado" e aceita soma menor que o total
 * (o restante fica no fiado); sem ele (pagamento posterior) só formas de pagamento.
 * Apenas pré-visualiza: quem valida e grava é o servidor (`onSubmit`).
 */
export function PaymentDialog({
  open,
  onOpenChange,
  totalCents,
  allowFiado,
  title,
  confirmLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Valor a distribuir: total (conclusão) ou saldo (pagamento posterior). */
  totalCents: number;
  allowFiado: boolean;
  title: string;
  confirmLabel: string;
  onSubmit: (payments: PaymentLine[]) => Promise<PaymentSubmitResult>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        {/* Montado só enquanto aberto: o estado reinicia a cada abertura. */}
        <PaymentForm
          totalCents={totalCents}
          allowFiado={allowFiado}
          title={title}
          confirmLabel={confirmLabel}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  totalCents,
  allowFiado,
  title,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  totalCents: number;
  allowFiado: boolean;
  title: string;
  confirmLabel: string;
  onSubmit: (payments: PaymentLine[]) => Promise<PaymentSubmitResult>;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [fiado, setFiado] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const zeroTotal = totalCents <= 0 && allowFiado;
  const isValid = (c: number | null): c is number => c != null && !Number.isNaN(c) && c > 0;
  const invalid = lines.some((l) => !isValid(l.cents));
  const sum = lines.reduce((s, l) => s + (isValid(l.cents) ? l.cents : 0), 0);
  const remaining = totalCents - sum;
  const over = sum > totalCents;
  const canConfirm = zeroTotal || fiado || (lines.length > 0 && !invalid && !over);

  function patch(key: number, change: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
    setError(null);
    setFieldErrors({});
  }

  function pickMethod(m: PaymentMethodValue) {
    setFiado(false);
    setError(null);
    setFieldErrors({});
    if (lines.length === 0) {
      setLines([{ key: nextKey, method: m, cents: totalCents }]);
      setNextKey(nextKey + 1);
    } else {
      patch(lines[0].key, { method: m });
    }
  }

  function pickFiado() {
    setFiado(true);
    setLines([]);
    setError(null);
    setFieldErrors({});
  }

  function addLine() {
    const used = new Set(lines.map((l) => l.method));
    const method = PAYMENT_METHODS.find((m) => !used.has(m)) ?? "CASH";
    setLines([...lines, { key: nextKey, method, cents: remaining > 0 ? remaining : null }]);
    setNextKey(nextKey + 1);
  }

  function confirm() {
    if (!canConfirm) return;
    const payments: PaymentLine[] =
      fiado || zeroTotal ? [] : lines.map((l) => ({ method: l.method, amountCents: l.cents! }));
    startTransition(async () => {
      const r = await onSubmit(payments);
      if (r.ok) return;
      setError(r.error);
      setFieldErrors(r.fieldErrors ?? {});
    });
  }

  function lineError(index: number): string | undefined {
    return fieldErrors[`payments.${index}.amountCents`] ?? fieldErrors.amountCents;
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {allowFiado ? "Total do atendimento" : "Saldo em aberto"}:{" "}
          <Money cents={totalCents} className="text-foreground text-base font-semibold" />
        </DialogDescription>
      </DialogHeader>

      {zeroTotal ? (
        <p className="bg-muted rounded-lg p-3 text-sm">
          O total é R$ 0,00: não há nada a receber. Confirme para concluir o atendimento.
        </p>
      ) : (
        <div role="group" aria-label="Forma de pagamento" className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <MethodButton
              key={m}
              label={PAYMENT_METHOD_LABEL[m]}
              selected={!fiado && lines[0]?.method === m}
              disabled={pending}
              onClick={() => pickMethod(m)}
            />
          ))}
          {allowFiado && (
            <MethodButton
              label="Fiado"
              selected={fiado}
              disabled={pending}
              onClick={pickFiado}
              className="col-span-2"
            />
          )}
        </div>
      )}

      {fiado && (
        <p role="status" className="bg-muted rounded-lg p-3 text-sm">
          Fiado: nada entra no caixa agora. O atendimento é concluído e{" "}
          <Money cents={totalCents} className="font-semibold" /> fica para receber depois.
        </p>
      )}

      {lines.length > 0 && (
        <div className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <div key={l.key} className="flex flex-col gap-2">
              {i > 0 && (
                <div className="flex items-center gap-2">
                  <div
                    role="radiogroup"
                    aria-label={`Forma da linha ${i + 1}`}
                    className="grid flex-1 grid-cols-4 gap-1"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={l.method === m}
                        disabled={pending}
                        onClick={() => patch(l.key, { method: m })}
                        className={cn(
                          "focus-visible:ring-ring/50 min-h-11 rounded-lg border px-1 text-xs font-medium outline-none focus-visible:ring-3",
                          l.method === m
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted",
                        )}
                      >
                        {PAYMENT_METHOD_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11"
                    disabled={pending}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="sr-only">Remover linha {i + 1}</span>
                  </Button>
                </div>
              )}
              <MoneyInput
                aria-label={`Valor em ${PAYMENT_METHOD_LABEL[l.method]}${lines.length > 1 ? ` (linha ${i + 1})` : ""}`}
                value={l.cents}
                onChange={(c) => patch(l.key, { cents: c })}
                error={
                  lineError(i) ??
                  (l.cents === null
                    ? "Informe o valor"
                    : l.cents === 0
                      ? "Informe um valor maior que zero"
                      : undefined)
                }
                disabled={pending}
                className="h-12 text-lg"
              />
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {over ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              A soma passa do total em <Money cents={sum - totalCents} />. Reduza os valores.
            </p>
          ) : remaining > 0 && !invalid ? (
            <p
              role="status"
              className="rounded-lg bg-amber-400/15 p-3 text-sm font-medium text-amber-300"
            >
              {allowFiado ? (
                <>
                  Restante <Money cents={remaining} /> fica no fiado
                </>
              ) : (
                <>
                  Restante <Money cents={remaining} /> continua em aberto
                </>
              )}
            </p>
          ) : null}
          {lines.length < MAX_LINES && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={pending || remaining <= 0}
              onClick={addLine}
            >
              + outra forma
            </Button>
          )}
        </div>
      )}

      {error ? (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
          {stockProductIdOf(fieldErrors) !== null && (
            <AdjustStockLink productId={stockProductIdOf(fieldErrors)!} />
          )}
        </div>
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
          {pending ? "Salvando..." : fiado ? "Concluir no fiado" : confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function MethodButton({
  label,
  selected,
  disabled,
  onClick,
  className,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring/50 min-h-14 rounded-xl border-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background hover:bg-muted",
        className,
      )}
    >
      {label}
    </button>
  );
}
