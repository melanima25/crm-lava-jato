import Link from "next/link";
import { CarFront, ChevronRight, Plus } from "lucide-react";

import { DayFilter } from "@/components/orders/day-filter";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Money } from "@/components/money";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDaysYmd, formatTimeBR, formatYmdBR, ymdBR, ymdOrToday } from "@/lib/dates";
import { vehicleLabel } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { getDayCash, listOrders } from "@/server/orders/queries";

export const metadata = { title: "Atendimentos | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const STATUSES = ["OPEN", "DONE", "CANCELED"] as const;

export default async function AtendimentosPage({ searchParams }: PageProps<"/atendimentos">) {
  const sp = await searchParams;
  const today = ymdBR();
  const date = ymdOrToday(first(sp.data));
  const rawStatus = first(sp.status);
  const status = STATUSES.find((s) => s === rawStatus);

  const [all, cash] = await Promise.all([listOrders({ date }), getDayCash({ date })]);
  const orders = status ? all.filter((o) => o.status === status) : all;
  const active = all.filter((o) => o.status !== "CANCELED");
  const fiadoCents = all
    .filter((o) => o.status === "DONE")
    .reduce((sum, o) => sum + o.balanceCents, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Atendimentos</h1>
        <Link
          href="/atendimentos/novo"
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-12 w-full px-4 text-base sm:h-11 sm:w-auto",
          )}
        >
          <Plus aria-hidden="true" />
          Novo atendimento
        </Link>
      </header>

      <DayFilter
        date={date}
        today={today}
        prev={addDaysYmd(date, -1)}
        next={addDaysYmd(date, 1)}
        status={status}
        withStatus
      />

      <dl
        aria-label={`Resumo de ${formatYmdBR(date)}`}
        className="grid grid-cols-3 gap-2 text-center sm:gap-3"
      >
        <div className="bg-card rounded-xl border p-3">
          <dt className="text-muted-foreground text-xs">Atendimentos</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="summary-count">
            {active.length}
          </dd>
        </div>
        <div className="bg-card rounded-xl border p-3">
          <dt className="text-muted-foreground text-xs">Recebido</dt>
          <dd
            className="text-base font-semibold whitespace-nowrap sm:text-lg"
            data-testid="summary-received"
          >
            <Money cents={cash.totalCents} />
          </dd>
        </div>
        <div className="bg-card rounded-xl border p-3">
          <dt className="text-muted-foreground text-xs">Fiado</dt>
          <dd
            className="text-base font-semibold whitespace-nowrap sm:text-lg"
            data-testid="summary-fiado"
          >
            <Money cents={fiadoCents} />
          </dd>
        </div>
      </dl>

      {orders.length === 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-12 text-center"
        >
          <CarFront className="size-10" aria-hidden="true" />
          <p className="text-foreground font-medium">
            {status || all.length > 0
              ? "Nenhum atendimento com esse filtro"
              : date === today
                ? "Nenhum atendimento hoje ainda"
                : `Nenhum atendimento em ${formatYmdBR(date)}`}
          </p>
          <Link href="/atendimentos/novo" className={cn(buttonVariants(), "h-11 px-4")}>
            <Plus aria-hidden="true" />
            Novo atendimento
          </Link>
        </div>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Lista de atendimentos">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/atendimentos/${o.id}`}
                  className={cn(
                    "bg-card hover:bg-muted/50 flex min-h-16 items-center gap-3 rounded-xl border p-3",
                    o.status === "CANCELED" && "opacity-70",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                        {o.customer.name}
                      </span>
                      <OrderStatusBadge status={o.status} paymentStatus={o.paymentStatus} />
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-sm [overflow-wrap:anywhere]">
                      {formatTimeBR(o.occurredAt)} · {vehicleLabel(o.vehicle)}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-sm">
                      <span>
                        Total <Money cents={o.totalCents} className="font-medium" />
                      </span>
                      <span className="text-muted-foreground">
                        Pago <Money cents={o.paidCents} />
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className={cn(o.status === "CANCELED" && "opacity-70")}>
                    <TableCell className="px-4 py-3 tabular-nums">
                      {formatTimeBR(o.occurredAt)}
                    </TableCell>
                    <TableCell className="[overflow-wrap:anywhere] whitespace-normal">
                      <Link href={`/atendimentos/${o.id}`} className="font-medium hover:underline">
                        {o.customer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="[overflow-wrap:anywhere] whitespace-normal">
                      {vehicleLabel(o.vehicle)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money cents={o.totalCents} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money cents={o.paidCents} />
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} paymentStatus={o.paymentStatus} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/atendimentos/${o.id}`}
                        aria-label={`Abrir atendimento de ${o.customer.name}`}
                      >
                        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
