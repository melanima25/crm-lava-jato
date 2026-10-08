"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { dateTimeLocalBRToIso, toDateTimeLocalBR } from "@/lib/dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { createCashEntryAction, updateCashEntryAction } from "@/server/cash/actions";
import type { CashCategoryDTO, CashEntryDTO } from "@/server/cash/queries";

type Direction = "IN" | "OUT";

export type EntryFormSetup =
  | { mode: "create"; direction: Direction; systemKey?: "OPENING_BALANCE" }
  | { mode: "edit"; entry: CashEntryDTO };

const SEGMENT =
  "focus-visible:ring-ring/50 min-h-12 rounded-xl border-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3";

function titleOf(setup: EntryFormSetup) {
  if (setup.mode === "edit") return "Editar lançamento";
  if (setup.systemKey === "OPENING_BALANCE") return "Saldo inicial";
  return setup.direction === "OUT" ? "Nova despesa" : "Nova entrada";
}

function keyOf(setup: EntryFormSetup) {
  return setup.mode === "edit"
    ? `e${setup.entry.id}`
    : `n${setup.direction}${setup.systemKey ?? ""}`;
}

/** Lançamento manual de caixa (criar/editar). Dialog: o teclado do celular não tira o formulário da tela. */
export function EntryFormDialog({
  setup,
  categories,
  onClose,
}: {
  /** null = fechado. */
  setup: EntryFormSetup | null;
  /** Todas as categorias (ativas e inativas); o formulário só oferece as ativas da direção. */
  categories: CashCategoryDTO[];
  onClose: () => void;
}) {
  return (
    <Dialog open={setup !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto">
        {setup && (
          <EntryForm key={keyOf(setup)} setup={setup} categories={categories} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  setup,
  categories,
  onClose,
}: {
  setup: EntryFormSetup;
  categories: CashCategoryDTO[];
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = setup.mode === "edit" ? setup.entry : null;

  const [direction, setDirection] = useState<Direction>(
    setup.mode === "edit" ? setup.entry.direction : setup.direction,
  );
  const [amount, setAmount] = useState<number | null>(editing ? editing.amountCents : null);
  const [categoryId, setCategoryId] = useState<string>(() => {
    if (setup.mode === "edit") return setup.entry.category ? String(setup.entry.category.id) : "";
    if (setup.systemKey) {
      const c = categories.find((x) => x.systemKey === setup.systemKey && x.active);
      return c ? String(c.id) : "";
    }
    return "";
  });
  const [method, setMethod] = useState<PaymentMethodValue>(
    editing ? (editing.method as PaymentMethodValue) : "CASH",
  );
  const [maxNow] = useState(() => toDateTimeLocalBR());
  const [when, setWhen] = useState(() =>
    editing ? toDateTimeLocalBR(editing.occurredAt) : maxNow,
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Categorias da direção: ativas + a atual do lançamento (mesmo inativa) enquanto a direção não mudar.
  const options = categories.filter(
    (c) =>
      c.direction === direction &&
      (c.active || (editing?.category?.id === c.id && editing.direction === direction)),
  );

  function changeDirection(d: Direction) {
    if (d === direction) return;
    setDirection(d);
    // A categoria só vale na mesma direção: limpa a escolha (a lista muda).
    setCategoryId("");
    setErrors((e) => ({ ...e, categoryId: "" }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (amount === null) next.amountCents = "Informe o valor";
    else if (Number.isNaN(amount)) next.amountCents = "Valor inválido";
    else if (amount <= 0) next.amountCents = "O valor deve ser maior que zero";
    if (!categoryId) next.categoryId = "Selecione uma categoria";
    const iso = dateTimeLocalBRToIso(when);
    if (!iso) next.occurredAt = "Informe a data e a hora";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;

    const input = {
      direction,
      amountCents: amount as number,
      categoryId: Number(categoryId),
      method,
      occurredAt: iso as string,
      description: description.trim() || null,
    };
    startTransition(async () => {
      const r = editing
        ? await updateCashEntryAction(editing.id, input)
        : await createCashEntryAction(input);
      if (!r.ok) {
        const fe = r.fieldErrors ?? {};
        setErrors(fe);
        setFormError(Object.keys(fe).length === 0 ? r.error : null);
        return;
      }
      toast.success(editing ? "Lançamento atualizado" : "Lançamento registrado");
      onClose();
      router.refresh();
    });
  }

  const clearErr = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  const err = (k: string) => (errors[k] ? errors[k] : undefined);

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{titleOf(setup)}</DialogTitle>
        <DialogDescription>
          {setup.mode === "create" && setup.systemKey === "OPENING_BALANCE"
            ? "Registra o dinheiro que já existia no caixa, como entrada."
            : "Registre o que entrou ou saiu do caixa."}
        </DialogDescription>
      </DialogHeader>

      <div role="group" aria-label="Tipo" className="grid grid-cols-2 gap-2">
        {(
          [
            ["OUT", "Saída"],
            ["IN", "Entrada"],
          ] as const
        ).map(([d, label]) => (
          <button
            key={d}
            type="button"
            aria-pressed={direction === d}
            onClick={() => changeDirection(d)}
            className={cn(
              SEGMENT,
              direction === d
                ? d === "OUT"
                  ? "border-red-400 bg-red-400/15 text-red-300"
                  : "border-emerald-400 bg-emerald-400/15 text-emerald-300"
                : "bg-background hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cash-amount">Valor</Label>
        <MoneyInput
          id="cash-amount"
          value={amount}
          onChange={(v) => {
            setAmount(v);
            clearErr("amountCents");
          }}
          error={err("amountCents")}
          autoFocus
          className="h-12 text-lg"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cash-category">Categoria</Label>
        <select
          id="cash-category"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            clearErr("categoryId");
          }}
          aria-invalid={err("categoryId") ? true : undefined}
          aria-describedby={err("categoryId") ? "cash-category-error" : undefined}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-12 w-full rounded-lg border px-2.5 text-base outline-none focus-visible:ring-3"
        >
          <option value="">Selecione…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.active ? "" : " (inativa)"}
            </option>
          ))}
        </select>
        {err("categoryId") && (
          <p id="cash-category-error" role="alert" className="text-destructive text-sm">
            {err("categoryId")}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <span id="cash-method-label" className="text-sm font-medium">
          Forma de pagamento
        </span>
        <div
          role="group"
          aria-labelledby="cash-method-label"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
              className={cn(
                SEGMENT,
                "min-h-14",
                method === m
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {PAYMENT_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {err("method") && (
          <p role="alert" className="text-destructive text-sm">
            {err("method")}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cash-when">Data e hora</Label>
        <Input
          id="cash-when"
          type="datetime-local"
          value={when}
          max={maxNow}
          onChange={(e) => {
            setWhen(e.target.value);
            clearErr("occurredAt");
          }}
          aria-invalid={err("occurredAt") ? true : undefined}
          className="h-12 text-base"
        />
        {err("occurredAt") && (
          <p role="alert" className="text-destructive text-sm">
            {err("occurredAt")}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cash-description">Descrição (opcional)</Label>
        <Textarea
          id="cash-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          rows={2}
          aria-invalid={err("description") ? true : undefined}
          placeholder="Ex.: panos de microfibra"
        />
        {err("description") && (
          <p role="alert" className="text-destructive text-sm">
            {err("description")}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
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
        <Button type="submit" className="h-12" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : editing ? "Salvar alterações" : "Salvar lançamento"}
        </Button>
      </DialogFooter>
    </form>
  );
}
