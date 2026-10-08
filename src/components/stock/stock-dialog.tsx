"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { dateTimeLocalBRToIso, toDateTimeLocalBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import {
  adjustStockAction,
  registerStockInAction,
  registerStockOutAction,
  updateStockMovementAction,
} from "@/server/stock/actions";

export type StockDialogProduct = {
  id: number;
  name: string;
  unit: string;
  stockQuantity: number;
};

/** Dados da movimentação a editar (subconjunto do StockMovementDTO). */
export type EditableMovement = {
  id: number;
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  reason: string | null;
  occurredAt: Date;
  cashEntry: { id: number; amountCents: number; method: PaymentMethodValue } | null;
};

export type StockDialogKind = "in" | "out" | "adjust" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: StockDialogKind;
  product: StockDialogProduct;
  movement?: EditableMovement;
};

const OUT_SUGGESTIONS = ["Uso em serviço", "Perda", "Vencido"];

/** Diálogo de entrada, baixa, acerto de inventário ou edição de movimentação. Montado só enquanto aberto. */
export function StockDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <StockForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const INT = /^-?\d+$/;

function parseInteger(text: string): number | null {
  const t = text.trim();
  return INT.test(t) ? Number(t) : null;
}

function QuantityField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  error,
  allowNegative = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max?: number;
  disabled?: boolean;
  error?: string;
  allowNegative?: boolean;
}) {
  const n = parseInteger(value);
  const decimalError = /[.,]/.test(value)
    ? "Use um número inteiro, sem vírgula nem ponto."
    : undefined;
  function step(delta: number) {
    let next = (n ?? (delta > 0 ? min - 1 : min + 1)) + delta;
    if (!allowNegative && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    onChange(String(next));
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-12 shrink-0"
          aria-label="Diminuir quantidade"
          disabled={disabled || (!allowNegative && n !== null && n <= min)}
          onClick={() => step(-1)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Input
          id={id}
          type="text"
          inputMode={allowNegative ? "text" : "numeric"}
          autoComplete="off"
          value={value}
          disabled={disabled}
          // Mantém "," e "." visíveis (em vez de apagá-los): "2,5" virar 25 em silêncio seria um erro de 10x.
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ""))}
          aria-invalid={error ? true : undefined}
          className="h-12 text-center text-xl font-semibold tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          className="size-12 shrink-0"
          aria-label="Aumentar quantidade"
          disabled={disabled || (max !== undefined && n !== null && n >= max)}
          onClick={() => step(1)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {(error ?? decimalError) && (
        <p role="alert" className="text-destructive text-sm">
          {error ?? decimalError}
        </p>
      )}
    </div>
  );
}

function StockForm({
  kind,
  product,
  movement,
  onClose,
}: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const editType = kind === "edit" ? movement?.type : undefined;
  const isIn = kind === "in" || editType === "IN";
  const isOut = kind === "out" || editType === "OUT";
  const isAdjust = kind === "adjust";
  const isAdjustEdit = editType === "ADJUSTMENT";

  const initialWhen = toDateTimeLocalBR(movement?.occurredAt ?? new Date());
  const [qty, setQty] = useState(() =>
    movement
      ? String(isAdjustEdit ? movement.quantity : Math.abs(movement.quantity))
      : isAdjust
        ? String(product.stockQuantity)
        : isOut && product.stockQuantity === 0
          ? "0"
          : "1",
  );
  const [reason, setReason] = useState(movement?.reason ?? "");
  const [when, setWhen] = useState(initialWhen);
  const [withPurchase, setWithPurchase] = useState(!!movement?.cashEntry);
  const [amount, setAmount] = useState<number | null>(movement?.cashEntry?.amountCents ?? null);
  const [method, setMethod] = useState<PaymentMethodValue | null>(
    movement?.cashEntry?.method ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  const n = parseInteger(qty);
  const nowLocal = toDateTimeLocalBR();
  const whenIso = dateTimeLocalBRToIso(when);
  const whenValid = whenIso !== null && when <= nowLocal;
  const amountValid = amount !== null && !Number.isNaN(amount) && amount > 0;
  const purchaseValid = !withPurchase || (amountValid && method !== null);

  // Baixa: limite visual = saldo atual (o servidor revalida). Edição de baixa não limita (depende do histórico).
  const outMax = kind === "out" ? product.stockQuantity : undefined;
  let qtyValid: boolean;
  if (isAdjust) qtyValid = n !== null && n >= 0;
  else if (isAdjustEdit) qtyValid = n !== null && n !== 0;
  else qtyValid = n !== null && n >= 1 && (outMax === undefined || n <= outMax);
  const diff = isAdjust && n !== null ? n - product.stockQuantity : null;
  const reasonValid = !isOut || reason.trim() !== "";
  const canConfirm =
    qtyValid && reasonValid && whenValid && purchaseValid && !(isAdjust && diff === 0);

  function clear() {
    setError(null);
    setFe({});
  }

  function submit() {
    if (!canConfirm || n === null) return;
    // Data intocada = omitida (o servidor usa "agora"; na edição, mantém a original).
    const occurredAt = when === initialWhen ? undefined : (whenIso ?? undefined);
    const reasonValue = reason.trim() === "" ? undefined : reason.trim();
    const purchase =
      withPurchase && amount !== null && method !== null
        ? { amountCents: amount, method }
        : undefined;
    startTransition(async () => {
      let r;
      if (kind === "in") {
        r = await registerStockInAction({
          productId: product.id,
          quantity: n,
          reason: reasonValue,
          occurredAt,
          purchase,
        });
      } else if (kind === "out") {
        r = await registerStockOutAction({
          productId: product.id,
          quantity: n,
          reason: reason.trim(),
          occurredAt,
        });
      } else if (kind === "adjust") {
        r = await adjustStockAction({
          productId: product.id,
          countedQuantity: n,
          reason: reasonValue,
          occurredAt,
        });
      } else {
        r = await updateStockMovementAction(movement!.id, {
          quantity: n,
          reason: reasonValue ?? "",
          occurredAt,
          ...(isIn ? { purchase: withPurchase ? purchase : null } : {}),
        });
      }
      if (!r.ok) {
        setError(r.error);
        setFe(r.fieldErrors ?? {});
        return;
      }
      const d = r.data;
      const saldo = `Estoque atual: ${d.stockQuantity} ${product.unit}`;
      const msg =
        kind === "in"
          ? `Entrada de ${n} ${product.unit} registrada. ${saldo}`
          : kind === "out"
            ? `Baixa de ${n} ${product.unit} registrada. ${saldo}`
            : kind === "adjust"
              ? `Inventário acertado. ${saldo}`
              : `Movimentação atualizada. ${saldo}`;
      toast.success(msg);
      router.refresh();
      onClose();
    });
  }

  const hasFieldError = [
    "quantity",
    "countedQuantity",
    "reason",
    "occurredAt",
    "purchase.amountCents",
    "purchase.method",
  ].some((k) => fe[k]);

  const titles: Record<StockDialogKind, string> = {
    in: "Entrada de estoque",
    out: "Baixa de estoque",
    adjust: "Acertar inventário",
    edit: isIn ? "Editar entrada" : isOut ? "Editar baixa" : "Editar acerto",
  };
  const qtyLabel = isAdjust
    ? "Quantidade contada"
    : isAdjustEdit
      ? "Diferença (com sinal, ex.: -3 ou 5)"
      : "Quantidade";
  const qtyError =
    fe.quantity ??
    fe.countedQuantity ??
    (kind === "out" && product.stockQuantity === 0
      ? "Sem estoque disponível para baixa"
      : undefined);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titles[kind]}</DialogTitle>
        <DialogDescription className="[overflow-wrap:anywhere]">
          <span className="text-foreground font-medium">{product.name}</span> · Atual:{" "}
          <span className="tabular-nums">
            {product.stockQuantity} {product.unit}
          </span>
        </DialogDescription>
      </DialogHeader>

      <QuantityField
        id={`${uid}-qty`}
        label={qtyLabel}
        value={qty}
        onChange={(v) => {
          setQty(v);
          clear();
        }}
        min={isAdjust ? 0 : 1}
        max={outMax}
        allowNegative={isAdjustEdit}
        disabled={pending}
        error={qtyError}
      />
      {outMax !== undefined && outMax > 0 && (
        <p className="text-muted-foreground -mt-2 text-xs">
          Disponível: {outMax} {product.unit}
        </p>
      )}

      {isAdjust && diff !== null && (
        <p
          data-testid="adjust-preview"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            diff === 0 ? "text-muted-foreground" : "bg-muted/60 text-foreground",
          )}
        >
          Atual: {product.stockQuantity} → diferença:{" "}
          <strong className="tabular-nums">
            {diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : "0"}
          </strong>
          {diff === 0 && " (igual ao saldo atual, nada a ajustar)"}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-reason`}>
          {isOut ? "Motivo (obrigatório)" : "Motivo (opcional)"}
        </Label>
        <Input
          id={`${uid}-reason`}
          value={reason}
          maxLength={200}
          disabled={pending}
          placeholder={
            isOut
              ? "Ex.: uso em serviço"
              : isAdjust
                ? "Ex.: contagem do mês"
                : "Ex.: compra no atacado"
          }
          onChange={(e) => {
            setReason(e.target.value);
            clear();
          }}
          aria-invalid={fe.reason ? true : undefined}
          className="h-12 text-base"
        />
        {isOut && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sugestões de motivo">
            {OUT_SUGGESTIONS.map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                className="h-10 px-3"
                disabled={pending}
                onClick={() => {
                  setReason(s);
                  clear();
                }}
              >
                {s}
              </Button>
            ))}
          </div>
        )}
        {fe.reason && (
          <p role="alert" className="text-destructive text-sm">
            {fe.reason}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-when`}>Data e hora</Label>
        <Input
          id={`${uid}-when`}
          type="datetime-local"
          value={when}
          max={nowLocal}
          disabled={pending}
          onChange={(e) => {
            setWhen(e.target.value);
            clear();
          }}
          aria-invalid={!whenValid || fe.occurredAt ? true : undefined}
          className="h-12 text-base"
        />
        {(fe.occurredAt || !whenValid) && (
          <p role="alert" className="text-destructive text-sm">
            {fe.occurredAt ?? "Informe uma data e hora válidas (não pode ser futura)"}
          </p>
        )}
      </div>

      {isIn && (
        <div className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${uid}-purchase`} className="text-base">
              Lançar compra no caixa
            </Label>
            <button
              id={`${uid}-purchase`}
              type="button"
              role="switch"
              aria-checked={withPurchase}
              disabled={pending}
              onClick={() => {
                setWithPurchase((v) => !v);
                clear();
              }}
              className={cn(
                "focus-visible:ring-ring/50 relative h-7 w-12 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
                withPurchase ? "bg-primary border-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-5.5 rounded-full transition-transform",
                  withPurchase ? "bg-primary-foreground translate-x-5" : "bg-muted-foreground",
                )}
              />
            </button>
          </div>
          {!withPurchase ? (
            <p className="text-muted-foreground text-sm">
              {movement?.cashEntry
                ? "Ao salvar, a despesa de compra vinculada será removida do caixa."
                : "Sem esta opção o caixa não muda: só o estoque é atualizado."}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-amount`}>Valor total da compra</Label>
                <MoneyInput
                  id={`${uid}-amount`}
                  value={amount}
                  onChange={(c) => {
                    setAmount(c);
                    clear();
                  }}
                  error={
                    fe["purchase.amountCents"] ??
                    (amount !== null && !Number.isNaN(amount) && amount <= 0
                      ? "Informe um valor maior que zero"
                      : undefined)
                  }
                  disabled={pending}
                  className="h-12 text-lg"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span id={`${uid}-method-label`} className="text-sm leading-none font-medium">
                  Forma de pagamento
                </span>
                <div
                  role="group"
                  aria-labelledby={`${uid}-method-label`}
                  className="grid grid-cols-2 gap-2"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={method === m}
                      disabled={pending}
                      onClick={() => {
                        setMethod(m);
                        clear();
                      }}
                      className={cn(
                        "focus-visible:ring-ring/50 min-h-12 rounded-xl border-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
                        method === m
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted",
                      )}
                    >
                      {PAYMENT_METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
                {fe["purchase.method"] && (
                  <p role="alert" className="text-destructive text-sm">
                    {fe["purchase.method"]}
                  </p>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Será lançada uma saída
                {amountValid ? ` de ${formatBRL(amount)}` : ""} em “Compra de produtos” no caixa.
              </p>
            </>
          )}
        </div>
      )}

      {/* Erro geral só quando não há mensagem junto de um campo (evita repetir o mesmo texto). */}
      {(error || fe.productId) && !hasFieldError && (
        <p role="alert" className="text-destructive text-sm">
          {fe.productId ?? error}
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-12 text-base"
          disabled={!canConfirm || pending}
          onClick={submit}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending
            ? "Salvando..."
            : kind === "in"
              ? "Registrar entrada"
              : kind === "out"
                ? "Registrar baixa"
                : kind === "adjust"
                  ? "Acertar estoque"
                  : "Salvar alterações"}
        </Button>
      </DialogFooter>
    </>
  );
}
