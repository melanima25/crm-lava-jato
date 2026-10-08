import Link from "next/link";
import { CalendarClock, ChevronRight, SearchX, Smile } from "lucide-react";

import { InactiveBadge } from "@/components/inactive-badge";
import { ListSearch } from "@/components/list-search";
import { Money } from "@/components/money";
import { ReceiveDialogHost, ReceiveRowButton } from "@/components/debt/receive-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateBR } from "@/lib/dates";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCustomerDebt, listDebtors } from "@/server/orders/queries";

export const metadata = { title: "Fiado | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const SORTS = [
  { value: "oldest", label: "Mais antigo" },
  { value: "balance", label: "Maior saldo" },
] as const;

function pendingLabel(n: number) {
  return n === 1 ? "1 atendimento" : `${n} atendimentos`;
}

export default async function FiadoPage({ searchParams }: PageProps<"/fiado">) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 120);
  const sort = first(sp.ordem) === "balance" ? "balance" : "oldest";
  const receiveId = Number(first(sp.receber));
  const searching = q.trim() !== "";

  const [{ debtors, totalCents, grandTotalCents }, debt] = await Promise.all([
    listDebtors({ q, sort }),
    Number.isInteger(receiveId) && receiveId > 0 ? getCustomerDebt(receiveId) : null,
  ]);

  const sortHref = (value: string) => {
    const params = new URLSearchParams();
    if (searching) params.set("q", q.trim());
    if (value !== "oldest") params.set("ordem", value);
    const qs = params.toString();
    return qs ? `/fiado?${qs}` : "/fiado";
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Fiado</h1>
        <p className="text-muted-foreground mt-1 text-sm">Quem deve, quanto e desde quando.</p>
      </header>

      <section
        aria-label="Total em aberto"
        className="bg-card flex flex-col gap-1 rounded-xl border p-4"
      >
        <p className="text-muted-foreground text-sm">Total em aberto</p>
        <p className="text-destructive text-3xl font-semibold" data-testid="fiado-total">
          <Money cents={grandTotalCents} />
        </p>
        {searching && (
          <p className="text-muted-foreground text-sm" data-testid="fiado-total-filtrado">
            Nesta busca: <Money cents={totalCents} className="text-foreground font-semibold" />
          </p>
        )}
      </section>

      <ListSearch
        initialQuery={q}
        initialIncludeInactive={false}
        label="Buscar devedor por nome, telefone ou placa"
        placeholder="Nome, telefone ou placa"
        showInactiveToggle={false}
      />

      {debtors.length > 1 && (
        <nav aria-label="Ordenar por" className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Ordenar:</span>
          <div className="bg-muted flex rounded-lg p-1">
            {SORTS.map((s) => (
              <Link
                key={s.value}
                href={sortHref(s.value)}
                replace
                scroll={false}
                aria-current={sort === s.value ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium",
                  sort === s.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </nav>
      )}

      {debtors.length === 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center"
        >
          {searching ? (
            <SearchX className="size-10" aria-hidden="true" />
          ) : (
            <Smile className="size-10" aria-hidden="true" />
          )}
          {searching ? (
            <>
              <p className="text-foreground font-medium">Nenhum devedor para “{q}”</p>
              <p className="text-sm">Confira o nome, o telefone ou a placa.</p>
            </>
          ) : (
            <>
              <p className="text-foreground font-medium">Ninguém deve nada por aqui</p>
              <p className="text-sm">
                Quando um atendimento ficar no fiado, ele aparece nesta lista.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {debtors.length === 1 ? "1 cliente devendo" : `${debtors.length} clientes devendo`}
          </p>

          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Clientes devendo">
            {debtors.map((d) => (
              <li
                key={d.customerId}
                data-testid="debtor"
                className="bg-card flex flex-col gap-3 rounded-xl border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/clientes/${d.customerId}`}
                        className="min-h-6 font-medium [overflow-wrap:anywhere] hover:underline"
                      >
                        {d.name}
                      </Link>
                      {!d.active && <InactiveBadge />}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {formatPhone(d.phone) || "Sem telefone"}
                    </p>
                  </div>
                  <Money
                    cents={d.balanceCents}
                    className="text-destructive text-lg font-semibold whitespace-nowrap"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground flex flex-col text-xs">
                    <span>{pendingLabel(d.pendingCount)}</span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      desde {formatDateBR(d.oldestPendingAt)}
                    </span>
                  </p>
                  <ReceiveRowButton customerId={d.customerId} customerName={d.name} />
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Atendimentos</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="px-4">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debtors.map((d) => (
                  <TableRow key={d.customerId} data-testid="debtor">
                    <TableCell className="px-4 py-3 [overflow-wrap:anywhere] whitespace-normal">
                      <Link
                        href={`/clientes/${d.customerId}`}
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        {d.name}
                        <ChevronRight
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden="true"
                        />
                      </Link>
                      {!d.active && (
                        <span className="ml-2">
                          <InactiveBadge />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatPhone(d.phone) || "—"}</TableCell>
                    <TableCell>{d.pendingCount}</TableCell>
                    <TableCell>{formatDateBR(d.oldestPendingAt)}</TableCell>
                    <TableCell className="text-right">
                      <Money
                        cents={d.balanceCents}
                        className="text-destructive font-semibold whitespace-nowrap"
                      />
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <ReceiveRowButton customerId={d.customerId} customerName={d.name} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {debt && debt.balanceCents > 0 && (
        <ReceiveDialogHost
          key={debt.customerId}
          debt={{
            customerId: debt.customerId,
            customerName: debt.customerName,
            balanceCents: debt.balanceCents,
            orders: debt.orders.map((o) => ({
              id: o.id,
              occurredAt: o.occurredAt,
              balanceCents: o.balanceCents,
            })),
          }}
        />
      )}
    </div>
  );
}
