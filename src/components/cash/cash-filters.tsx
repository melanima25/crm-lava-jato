"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDaysYmd, formatYmdBR } from "@/lib/dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import type { CashCategoryDTO } from "@/server/cash/queries";

/** Altera parâmetros da URL preservando os demais; qualquer mudança de filtro volta para a página 1. */
function useUrlNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(changes: Record<string, string | null>, opts: { keepPage?: boolean } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    if (!opts.keepPage) params.delete("pagina");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { navigate, pending };
}

const CHIP = cn(
  "focus-visible:ring-ring/50 min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3",
);
const chipClass = (active: boolean) =>
  cn(
    CHIP,
    active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
  );

const SELECT =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-2.5 text-base outline-none focus-visible:ring-3 md:text-sm";

export type PeriodView =
  { mode: "day"; date: string } | { mode: "week" | "month" | "range"; from: string; to: string };

/**
 * Seletor de período. URL: sem parâmetros = hoje; ?data=yyyy-mm-dd = um dia; ?periodo=semana|mes;
 * ?periodo=personalizado&de=yyyy-mm-dd&ate=yyyy-mm-dd.
 */
export function PeriodFilter({ view, today }: { view: PeriodView; today: string }) {
  const { navigate, pending } = useUrlNavigate();
  const [from, setFrom] = useState(view.mode === "day" ? view.date : view.from);
  const [to, setTo] = useState(view.mode === "day" ? view.date : view.to);

  const setDay = (d: string) =>
    navigate({ data: d === today ? null : d, periodo: null, de: null, ate: null });

  const isToday = view.mode === "day" && view.date === today;
  const iconBtn = "size-11 shrink-0";

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={isToday}
          className={chipClass(isToday)}
          onClick={() => setDay(today)}
        >
          Hoje
        </button>
        <button
          type="button"
          aria-pressed={view.mode === "week"}
          className={chipClass(view.mode === "week")}
          onClick={() => navigate({ periodo: "semana", data: null, de: null, ate: null })}
        >
          Semana
        </button>
        <button
          type="button"
          aria-pressed={view.mode === "month"}
          className={chipClass(view.mode === "month")}
          onClick={() => navigate({ periodo: "mes", data: null, de: null, ate: null })}
        >
          Mês
        </button>
        <button
          type="button"
          aria-pressed={view.mode === "range"}
          className={chipClass(view.mode === "range")}
          onClick={() =>
            navigate({
              periodo: "personalizado",
              de: addDaysYmd(today, -6),
              ate: today,
              data: null,
            })
          }
        >
          Personalizado
        </button>
        {pending && (
          <Loader2
            className="text-muted-foreground size-5 animate-spin self-center"
            aria-label="Carregando"
          />
        )}
      </div>

      {view.mode === "day" && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={iconBtn}
            aria-label="Dia anterior"
            onClick={() => setDay(addDaysYmd(view.date, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Input
            type="date"
            aria-label="Data"
            value={view.date}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="h-11 min-w-0 flex-1 text-base"
          />
          <Button
            type="button"
            variant="outline"
            className={iconBtn}
            aria-label="Próximo dia"
            disabled={view.date >= today}
            onClick={() => setDay(addDaysYmd(view.date, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}

      {view.mode === "range" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Início</span>
            <Input
              type="date"
              aria-label="Início"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value && to)
                  navigate({ periodo: "personalizado", de: e.target.value, ate: to, data: null });
              }}
              className="h-11 text-base"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Fim</span>
            <Input
              type="date"
              aria-label="Fim"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (e.target.value && from)
                  navigate({ periodo: "personalizado", de: from, ate: e.target.value, data: null });
              }}
              className="h-11 text-base"
            />
          </label>
        </div>
      )}

      {(view.mode === "week" || view.mode === "month") && (
        <p className="text-muted-foreground text-sm">
          {formatYmdBR(view.from)} a {formatYmdBR(view.to)}
        </p>
      )}
    </div>
  );
}

const DEBOUNCE_MS = 300;

/** Filtros do extrato: tipo, categoria, forma e busca (?tipo=&categoria=&forma=&q=). */
export function EntriesFilter({
  direction,
  categoryId,
  method,
  q,
  categories,
}: {
  direction: "IN" | "OUT" | "";
  categoryId: string;
  method: string;
  q: string;
  categories: CashCategoryDTO[];
}) {
  const { navigate, pending } = useUrlNavigate();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onText(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate({ q: v.trim() || null }), DEBOUNCE_MS);
  }

  const types = [
    ["", "Todos"],
    ["IN", "Entradas"],
    ["OUT", "Saídas"],
  ] as const;

  const visible = categories.filter((c) => !direction || c.direction === direction);

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div role="group" aria-label="Tipo de lançamento" className="flex flex-wrap gap-2">
        {types.map(([v, label]) => (
          <button
            key={v || "todos"}
            type="button"
            aria-pressed={direction === v}
            className={chipClass(direction === v)}
            onClick={() =>
              navigate({
                tipo: v === "IN" ? "entradas" : v === "OUT" ? "saidas" : null,
                categoria: null,
              })
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Categoria</span>
          <select
            value={categoryId}
            onChange={(e) => navigate({ categoria: e.target.value || null })}
            className={SELECT}
          >
            <option value="">Todas as categorias</option>
            {(!direction || direction === "IN") && (
              <option value="atendimentos">Atendimentos</option>
            )}
            {visible.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? "" : " (inativa)"}
                {direction ? "" : c.direction === "IN" ? " · entrada" : " · saída"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Forma de pagamento</span>
          <select
            value={method}
            onChange={(e) => navigate({ forma: e.target.value || null })}
            className={SELECT}
          >
            <option value="">Todas as formas</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <Input
          type="search"
          role="searchbox"
          aria-label="Buscar no extrato"
          placeholder="Buscar por descrição, categoria, cliente ou nº do atendimento"
          value={text}
          onChange={(e) => onText(e.target.value)}
          autoComplete="off"
          className="h-12 pr-12 pl-10 text-base [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <div className="absolute top-1/2 right-1 -translate-y-1/2">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => {
                setText("");
                navigate({ q: null });
              }}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Limpar busca</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
