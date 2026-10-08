import Link from "next/link";
import { Wallet } from "lucide-react";

import { EntriesFilter, PeriodFilter, type PeriodView } from "@/components/cash/cash-filters";
import { EntryList } from "@/components/cash/entry-list";
import { NewEntryActions } from "@/components/cash/new-entry-actions";
import { Money } from "@/components/money";
import { buttonVariants } from "@/components/ui/button";
import { formatYmdBR, ymdBR, ymdOrToday } from "@/lib/dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { getCashSummary, listCashCategories, listCashEntries } from "@/server/cash/queries";

export const metadata = { title: "Caixa | TZ Auto Estética" };

// Dia: tudo em uma página (o fechamento do dia confere linha a linha); períodos longos paginam.
const PAGE_SIZE = 50;
const DAY_PAGE_SIZE = 200;

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default async function CaixaPage({ searchParams }: PageProps<"/caixa">) {
  const sp = await searchParams;
  const today = ymdBR();

  // ---- período (compatível com ?data=yyyy-mm-dd) ----
  const periodo = first(sp.periodo);
  const data = first(sp.data);
  let periodInput: { preset: "today" | "week" | "month" | "custom"; from?: string; to?: string };
  let mode: "day" | "week" | "month" | "range";
  if (periodo === "semana") {
    periodInput = { preset: "week" };
    mode = "week";
  } else if (periodo === "mes") {
    periodInput = { preset: "month" };
    mode = "month";
  } else if (periodo === "personalizado") {
    const de = first(sp.de);
    const ate = first(sp.ate);
    const from = de && YMD.test(de) ? ymdOrToday(de) : today;
    const to = ate && YMD.test(ate) ? ymdOrToday(ate) : today;
    periodInput = { preset: "custom", from, to };
    mode = "range";
  } else {
    const day = ymdOrToday(data);
    periodInput = day === today ? { preset: "today" } : { preset: "custom", from: day, to: day };
    mode = "day";
  }

  // ---- filtros do extrato ----
  const tipo = first(sp.tipo);
  const direction = tipo === "entradas" ? "IN" : tipo === "saidas" ? "OUT" : undefined;
  const cat = first(sp.categoria);
  const categoryId =
    cat === "atendimentos"
      ? ("ORDERS" as const)
      : cat && /^\d+$/.test(cat)
        ? Number(cat)
        : undefined;
  const forma = first(sp.forma);
  const method = PAYMENT_METHODS.find((m) => m === forma);
  const q = (first(sp.q) ?? "").trim();
  const pageParam = Number(first(sp.pagina));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const [summary, list, categories] = await Promise.all([
    getCashSummary(periodInput),
    listCashEntries({
      ...periodInput,
      direction,
      categoryId,
      method,
      q,
      page,
      limit: mode === "day" ? DAY_PAGE_SIZE : PAGE_SIZE,
    }),
    listCashCategories({ includeInactive: true }),
  ]);

  const { from, to } = summary.period;
  const isDay = mode === "day";
  const view: PeriodView = mode === "day" ? { mode, date: from } : { mode, from, to };
  const hasFilters = Boolean(direction || categoryId !== undefined || method || q);
  const incomeCats = summary.byCategory.filter((c) => c.direction === "IN");
  const expenseCats = summary.byCategory.filter((c) => c.direction === "OUT");

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = first(v);
      if (val && k !== "pagina") params.set(k, val);
    }
    if (p > 1) params.set("pagina", String(p));
    const qs = params.toString();
    return qs ? `/caixa?${qs}` : "/caixa";
  };

  const clearParams = new URLSearchParams();
  for (const k of ["data", "periodo", "de", "ate"]) {
    const v = first(sp[k]);
    if (v) clearParams.set(k, v);
  }
  const clearHref = clearParams.size ? `/caixa?${clearParams}` : "/caixa";

  const periodText = from === to ? formatYmdBR(from) : `${formatYmdBR(from)} a ${formatYmdBR(to)}`;
  const negative = summary.balanceCents < 0;

  return (
    <div className="flex flex-col gap-5 pb-16 md:pb-0">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isDay ? "Caixa do dia" : "Caixa"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Entradas e saídas de {periodText}, com o saldo acumulado do caixa.
          </p>
        </div>
        <NewEntryActions categories={categories} />
      </header>

      <PeriodFilter key={`${mode}|${from}|${to}`} view={view} today={today} />

      <section aria-label="Totais" className="flex flex-col gap-3">
        <div
          className={cn(
            "bg-silver rounded-xl p-4 shadow-lg shadow-black/40",
            negative ? "text-red-900" : "text-primary-foreground",
          )}
        >
          <p className="text-sm font-medium opacity-80">Saldo acumulado</p>
          <p
            className="text-3xl font-semibold tabular-nums"
            data-testid="cash-balance"
            data-negative={negative || undefined}
          >
            <Money cents={summary.balanceCents} />
          </p>
          <p className="mt-1 text-xs opacity-80">
            Tudo que entrou menos tudo que saiu até {formatYmdBR(to)}.
            {summary.openingBalanceCents !== 0 && (
              <>
                {" "}
                Saldo no início do período:{" "}
                <span data-testid="cash-opening">
                  <Money cents={summary.openingBalanceCents} />
                </span>
                .
              </>
            )}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
          <div className="bg-card rounded-xl border p-3">
            <dt className="text-muted-foreground text-xs">Entradas</dt>
            <dd
              className="text-lg font-semibold text-emerald-400 tabular-nums"
              data-testid="cash-total"
            >
              <Money cents={summary.inCents} />
            </dd>
          </div>
          <div className="bg-card rounded-xl border p-3">
            <dt className="text-muted-foreground text-xs">Saídas</dt>
            <dd className="text-lg font-semibold text-red-400 tabular-nums" data-testid="cash-out">
              <Money cents={summary.outCents} />
            </dd>
          </div>
          <div className="bg-card rounded-xl border p-3">
            <dt className="text-muted-foreground text-xs">Resultado do período</dt>
            <dd
              className={cn(
                "text-lg font-semibold tabular-nums",
                summary.resultCents < 0 ? "text-red-400" : "text-foreground",
              )}
              data-testid="cash-result"
            >
              <Money cents={summary.resultCents} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="Totais por forma de pagamento" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Por forma de pagamento</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {PAYMENT_METHODS.map((m) => {
            const t = summary.byMethod[m];
            return (
              <div key={m} className="bg-card rounded-xl border p-3">
                <p className="text-sm font-medium">{PAYMENT_METHOD_LABEL[m]}</p>
                <dl className="mt-1 flex flex-col gap-0.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Entradas</dt>
                    <dd className="text-emerald-400 tabular-nums" data-testid={`cash-${m}`}>
                      <Money cents={t.inCents} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Saídas</dt>
                    <dd className="text-red-400 tabular-nums" data-testid={`cash-out-${m}`}>
                      <Money cents={t.outCents} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-t pt-0.5 font-semibold">
                    <dt className="text-muted-foreground font-normal">Líquido</dt>
                    <dd
                      className={cn("tabular-nums", t.netCents < 0 && "text-red-400")}
                      data-testid={`cash-net-${m}`}
                    >
                      <Money cents={t.netCents} />
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      {summary.byCategory.length > 0 && (
        <section aria-label="Totais por categoria" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Por categoria</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {[
              ["Entradas", incomeCats, "text-emerald-400"],
              ["Saídas", expenseCats, "text-red-400"],
            ].map(([label, rows, color]) => {
              const items = rows as typeof incomeCats;
              if (items.length === 0) return null;
              return (
                <div key={label as string} className="bg-card rounded-xl border p-3">
                  <p className="text-muted-foreground mb-1 text-xs">{label as string}</p>
                  <dl className="flex flex-col gap-1">
                    {items.map((c) => (
                      <div
                        key={`${c.categoryId ?? "os"}-${c.direction}`}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <dt className="min-w-0 [overflow-wrap:anywhere]">
                          {c.name}
                          <span className="text-muted-foreground"> ({c.count})</span>
                        </dt>
                        <dd
                          className={cn(
                            "font-medium whitespace-nowrap tabular-nums",
                            color as string,
                          )}
                        >
                          <Money cents={c.totalCents} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section aria-label="Extrato" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Extrato</h2>
          <p className="text-muted-foreground text-sm" data-testid="cash-count">
            {list.total} {list.total === 1 ? "lançamento" : "lançamentos"}
          </p>
        </div>

        <EntriesFilter
          direction={direction ?? ""}
          categoryId={
            categoryId === undefined
              ? ""
              : categoryId === "ORDERS"
                ? "atendimentos"
                : String(categoryId)
          }
          method={method ?? ""}
          q={q}
          categories={categories}
        />

        {list.items.length === 0 ? (
          <div
            role="status"
            className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center"
          >
            <Wallet className="size-10" aria-hidden="true" />
            <p className="text-foreground font-medium">
              {hasFilters
                ? "Nenhum lançamento encontrado com esses filtros"
                : "Nenhum lançamento neste período"}
            </p>
            {hasFilters ? (
              <Link href={clearHref} className={cn(buttonVariants({ variant: "outline" }), "h-11")}>
                Limpar filtros
              </Link>
            ) : (
              <p className="text-sm">
                Pagamentos de atendimentos e lançamentos manuais aparecem aqui.
              </p>
            )}
          </div>
        ) : (
          <>
            <EntryList items={list.items} categories={categories} />
            {list.pageCount > 1 && (
              <nav aria-label="Paginação" className="flex items-center justify-between gap-2">
                {list.page > 1 ? (
                  <Link
                    href={pageHref(list.page - 1)}
                    className={cn(buttonVariants({ variant: "outline" }), "h-11")}
                  >
                    Anterior
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground text-sm">
                  Página {list.page} de {list.pageCount}
                </span>
                {list.page < list.pageCount ? (
                  <Link
                    href={pageHref(list.page + 1)}
                    className={cn(buttonVariants({ variant: "outline" }), "h-11")}
                  >
                    Próxima
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
