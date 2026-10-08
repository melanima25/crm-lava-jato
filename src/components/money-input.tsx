"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatBRL, parseBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type MoneyInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "inputMode"
> & {
  /** Valor em centavos (inteiro); `null`/`undefined` = campo vazio. */
  value?: number | null;
  /** Recebe centavos; `null` = campo vazio; `NaN` = texto inválido (nunca confundir com vazio). */
  onChange?: (cents: number | null) => void; // NaN quando inválido
  /** Mensagem de erro externa (ex.: do react-hook-form); tem prioridade sobre a interna. */
  error?: string;
};

type Parsed = { cents: number | null; error: string | null }; // cents NaN = inválido

function parse(text: string): Parsed {
  if (text.trim() === "") return { cents: null, error: null };
  try {
    return { cents: parseBRL(text), error: null };
  } catch (e) {
    return { cents: Number.NaN, error: e instanceof Error ? e.message : "Valor inválido." };
  }
}

/** "R$ 1.234,56" -> "1.234,56" (o prefixo "R$" fica fora do campo). */
function toText(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "";
  return formatBRL(cents).replace(/^R\$\s*/, "");
}

/**
 * Campo de valor em BRL: o usuário digita "1.234,56" e o componente entrega centavos.
 * Controlado (value/onChange em centavos), pronto para `Controller` do react-hook-form.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, error, className, onBlur, "aria-describedby": describedBy, id, ...props },
  ref,
) {
  const autoId = React.useId();
  const errorId = `${id ?? autoId}-error`;

  const [text, setText] = React.useState(() => toText(value));
  const [touched, setTouched] = React.useState(false);

  // Sincroniza com mudanças externas de `value` (ex.: reset do formulário).
  const [lastValue, setLastValue] = React.useState(value);
  if (!Object.is(value, lastValue)) {
    setLastValue(value);
    if (!Object.is(value ?? null, parse(text).cents)) setText(toText(value));
  }

  const parsed = parse(text);
  // Texto inválido: a mensagem específica do parse vence a genérica do formulário.
  const message = parsed.error && (touched || error) ? parsed.error : (error ?? null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setText(next);
    const { cents } = parse(next); // NaN se inválido
    setLastValue(cents);
    onChange?.(cents);
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setTouched(true);
    if (parsed.cents !== null && !Number.isNaN(parsed.cents)) setText(toText(parsed.cents));
    onBlur?.(e);
  }

  return (
    <div className="w-full">
      <div className="relative">
        <span
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
        >
          R$
        </span>
        <Input
          ref={ref}
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={message ? true : undefined}
          aria-describedby={
            message ? [describedBy, errorId].filter(Boolean).join(" ") : describedBy
          }
          className={cn("pl-9 tabular-nums", className)}
          {...props}
        />
      </div>
      {message ? (
        <p id={errorId} role="alert" className="text-destructive mt-1 text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
});
