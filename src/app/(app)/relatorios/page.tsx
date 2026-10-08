import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { Money } from "@/components/money";
import {
  ReportPeriodFilter,
  type ReportPeriodMode,
} from "@/components/reports/report-period-filter";
import { buttonVariants } from "@/components/ui/button";
import { formatDateBR, formatYmdBR, ymdBR, ymdOrToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  getSalesReport,
  getTopCustomers,
  getTopItems,
  type TopItemSort,
  type TopItemsReport,
} from "@/server/reports/queries";

export const metadata = { title: "Relatórios | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type PeriodInput = {
  preset: "today" | "week" | "month" | "lastMonth" | "custom";
  from?: string;
  to?: string;
};

function formatMonthKey(key: string) {
  const [y, m] = key.split("-");
  return `${m}/${y}`;
}

const TH = "text-muted-foreground px-3 py-2 text-xs font-medium whitespace-nowrap";
// Abaixo de 640 px a tabela vira lista de cartões (mesmo DOM, só CSS): cada <tr> é uma grade de 2 colunas,
// o nome ocupa a linha de cima e cada número aparece com seu rótulo (data-label) via ::before.
const TABLE = "w-full text-sm max-sm:block";
const THEAD = "max-sm:sr-only";
const TBODY = "max-sm:block";
const TR =
  "border-b last:border-0 max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-1 max-sm:px-3 max-sm:py-2.5";
const TD =
  "px-3 py-2 whitespace-nowrap tabular-nums max-sm:flex max-sm:flex-col max-sm:items-start max-sm:p-0 max-sm:text-left max-sm:whitespace-normal before:text-muted-foreground before:text-xs before:content-[attr(data-label)] sm:before:content-none";
const TD_NAME = "px-3 py-2 max-sm:col-span-full max-sm:p-0 max-sm:font-medium";

export default async function RelatoriosPage({ searchParams }: PageProps<"/relatorios">) {
  const sp = await searchParams;
  const today = ymdBR();

  const periodo = first(sp.periodo);
  let mode: ReportPeriodMode;
  let periodInput: PeriodInput;
  if (periodo === "semana") {
    mode = "semana";
    periodInput = { preset: "week" };
  } else if (periodo === "mes") {
    mode = "mes";
    periodInput = { preset: "month" };
  } else if (periodo === "mes-passado") {
    mode = "mes-passado";
    periodInput = { preset: "lastMonth" };
  } else if (periodo === "personalizado") {
    const de = first(sp.de);
    const ate = first(sp.ate);
    mode = "personalizado";
    periodInput = {
      preset: "custom",
      from: de && YMD.test(de) ? ymdOrToday(de) : today,
      to: ate && YMD.test(ate) ? ymdOrToday(ate) : today,
    };
  } else {
    mode = "hoje";
    periodInput = { preset: "today" };
  }

  const servicesSort: TopItemSort = first(sp.servicos) === "valor" ? "value" : "quantity";
  const productsSort: TopItemSort = first(sp.produtos) === "valor" ? "value" : "quantity";

  const [sales, services, products, customers] = await Promise.all([
    getSalesReport(periodInput),
    getTopItems(periodInput, "SERVICE", servicesSort),
    getTopItems(periodInput, "PRODUCT", productsSort),
    getTopCustomers(periodInput),
  ]);

  const { fromYmd, toYmd } = sales.period;
  const periodText =
    fromYmd === toYmd ? formatYmdBR(fromYmd) : `${formatYmdBR(fromYmd)} a ${formatYmdBR(toYmd)}`;
  const isMonthly = sales.granularity === "month";
  const maxCents = Math.max(1, ...sales.rows.map((r) => Math.max(r.soldCents, r.receivedCents)));
  const discountCents = sales.discountCents;

  const sortHref = (key: "servicos" | "produtos", value: "valor" | null) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = first(v);
      if (val && k !== key) params.set(k, val);
    }
    if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/relatorios?${qs}` : "/relatorios";
  };

  const cards: {
    label: string;
    testId: string;
    help: string;
    value: React.ReactNode;
    note?: React.ReactNode;
    tone?: string;
  }[] = [
    {
      label: "Vendido",
      testId: "report-sold",
      help: "Total dos atendimentos concluídos no período, mesmo os que ficaram no fiado.",
      value: <Money cents={sales.soldCents} />,
    },
    {
      label: "Recebido",
      testId: "report-received",
      help: "Dinheiro que realmente entrou no caixa por atendimentos no período.",
      value: <Money cents={sales.receivedCents} />,
      tone: "text-emerald-400",
      note:
        sales.receivedFromPriorCents > 0 ? (
          <span data-testid="report-received-prior">
            dos quais <Money cents={sales.receivedFromPriorCents} /> são fiado de atendimentos
            anteriores ao período
          </span>
        ) : undefined,
    },
    {
      label: "Ficou no fiado",
      testId: "report-pending",
      help: "Parte do vendido no período que ainda não foi paga (situação de hoje).",
      value: <Money cents={sales.pendingCents} />,
      tone: sales.pendingCents > 0 ? "text-destructive" : undefined,
    },
    {
      label: "Atendimentos",
      testId: "report-orders",
      help: "Atendimentos concluídos no período.",
      value: sales.ordersCount,
    },
    {
      label: "Ticket médio",
      testId: "report-ticket",
      help: "Vendido dividido pelo número de atendimentos.",
      value: sales.averageTicketCents === null ? "—" : <Money cents={sales.averageTicketCents} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5 pb-16 md:pb-0">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Vendas, itens mais vendidos e clientes mais frequentes de {periodText}.
        </p>
      </header>

      <ReportPeriodFilter
        key={`${mode}|${fromYmd}|${toYmd}`}
        mode={mode}
        from={fromYmd}
        to={toYmd}
        today={today}
      />

      {sales.period.truncated && (
        <p
          role="status"
          data-testid="report-truncated"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
        >
          O período foi encurtado para 366 dias (de {formatYmdBR(fromYmd)} a {formatYmdBR(toYmd)}).
        </p>
      )}

      <section
        aria-label="Resumo"
        className="grid grid-cols-2 gap-2 lg:grid-cols-5"
      >
        {cards.map((c) => (
          <div
            key={c.testId}
            className="bg-card flex min-w-0 flex-col gap-1 rounded-xl border p-3 max-sm:p-2.5 max-sm:last:col-span-2 lg:last:col-span-1"
          >
            <p className="text-muted-foreground text-xs">{c.label}</p>
            <p
              className={cn("text-base font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-xl", c.tone)}
              data-testid={c.testId}
            >
              {c.value}
            </p>
            {c.note && <p className="text-[11px] leading-tight text-emerald-400/90 sm:text-xs">{c.note}</p>}
            <p className="text-muted-foreground text-xs max-sm:hidden">{c.help}</p>
          </div>
        ))}
      </section>

      <section aria-label={isMonthly ? "Por mês" : "Por dia"} className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{isMonthly ? "Por mês" : "Por dia"}</h2>
        {sales.rows.length === 0 ? (
          <Empty text="Nenhum atendimento concluído neste período" />
        ) : (
          <div className="bg-card overflow-x-auto rounded-xl border">
            <table className={TABLE} data-testid="report-by-period">
              <thead className={THEAD}>
                <tr className="border-b text-left">
                  <th className={TH}>{isMonthly ? "Mês" : "Data"}</th>
                  <th className={cn(TH, "text-right")}>Atend.</th>
                  <th className={cn(TH, "text-right")}>Vendido</th>
                  <th className={cn(TH, "text-right")}>Recebido</th>
                  <th className={cn(TH, "relative w-1/3 min-w-32")}>
                    <span className="sr-only">Gráfico</span>
                  </th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {sales.rows.map((r) => (
                  <tr key={r.key} className={TR} data-testid="report-row">
                    <td className={cn(TD, "max-sm:col-span-full max-sm:font-medium max-sm:before:hidden")}>
                      {isMonthly ? formatMonthKey(r.key) : formatYmdBR(r.key)}
                    </td>
                    <td data-label="Atend." className={cn(TD, "text-right")}>{r.ordersCount}</td>
                    <td data-label="Vendido" className={cn(TD, "text-right")}>
                      <Money cents={r.soldCents} />
                    </td>
                    <td data-label="Recebido" className={cn(TD, "text-right text-emerald-400")}>
                      <Money cents={r.receivedCents} />
                    </td>
                    <td className="px-3 py-2 max-sm:col-span-full max-sm:p-0 max-sm:pt-1" aria-hidden="true">
                      <div className="flex flex-col gap-1">
                        <div
                          className="bg-silver h-2 rounded-full"
                          style={{ width: `${(r.soldCents / maxCents) * 100}%` }}
                        />
                        <div
                          className="h-2 rounded-full bg-emerald-500/70"
                          style={{ width: `${(r.receivedCents / maxCents) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sales.rows.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Barra clara = vendido; barra verde = recebido no dia (inclui fiado antigo quitado).
          </p>
        )}
      </section>

      <ItemsSection
        title="Serviços mais vendidos"
        testId="report-services"
        report={services}
        sort={servicesSort}
        sortKey="servicos"
        sortHref={sortHref}
        withVehicle
        emptyText="Nenhum serviço vendido neste período"
      />

      <ItemsSection
        title="Produtos mais vendidos"
        testId="report-products"
        report={products}
        sort={productsSort}
        sortKey="produtos"
        sortHref={sortHref}
        emptyText="Nenhum produto vendido neste período"
      />

      <p className="text-muted-foreground text-xs" data-testid="report-discount-note">
        Os valores dos rankings são brutos: o desconto dado no atendimento não é rateado entre os
        itens. Total de descontos no período: <Money cents={discountCents} />.
      </p>

      <section aria-label="Clientes mais frequentes" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Clientes mais frequentes</h2>
        {customers.rows.length === 0 ? (
          <Empty text="Nenhum cliente atendido neste período" />
        ) : (
          <div className="bg-card overflow-x-auto rounded-xl border">
            <table className={TABLE} data-testid="report-customers">
              <thead className={THEAD}>
                <tr className="border-b text-left">
                  <th className={TH}>Cliente</th>
                  <th className={cn(TH, "text-right")}>Visitas</th>
                  <th className={cn(TH, "text-right")}>Valor</th>
                  <th className={TH}>Última visita</th>
                  <th className={cn(TH, "text-right")}>Saldo devedor</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {customers.rows.map((c) => (
                  <tr key={c.customerId} className={TR}>
                    <td className={TD_NAME}>
                      <Link
                        href={`/clientes/${c.customerId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                      {!c.active && <span className="text-muted-foreground"> (inativo)</span>}
                    </td>
                    <td data-label="Visitas" className={cn(TD, "text-right")}>{c.visits}</td>
                    <td data-label="Valor" className={cn(TD, "text-right")}>
                      <Money cents={c.totalCents} />
                    </td>
                    <td data-label="Última visita" className={TD}>{formatDateBR(c.lastVisitAt)}</td>
                    <td
                      data-label="Saldo devedor"
                      className={cn(
                        TD,
                        "text-right",
                        c.debtCents > 0 && "text-destructive font-medium",
                      )}
                    >
                      <Money cents={c.debtCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-muted-foreground text-sm">
        Despesas, resultado e saldo ficam no{" "}
        <Link href="/caixa" className={cn(buttonVariants({ variant: "link" }), "h-auto p-0")}>
          Caixa
        </Link>
        .
      </p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center"
    >
      <BarChart3 className="size-8" aria-hidden="true" />
      <p className="text-foreground text-sm font-medium">{text}</p>
    </div>
  );
}

function ItemsSection({
  title,
  testId,
  report,
  sort,
  sortKey,
  sortHref,
  withVehicle = false,
  emptyText,
}: {
  title: string;
  testId: string;
  report: TopItemsReport;
  sort: TopItemSort;
  sortKey: "servicos" | "produtos";
  sortHref: (key: "servicos" | "produtos", value: "valor" | null) => string;
  withVehicle?: boolean;
  emptyText: string;
}) {
  const chips: [TopItemSort, string, "valor" | null][] = [
    ["quantity", "Por quantidade", null],
    ["value", "Por valor", "valor"],
  ];
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div role="group" aria-label="Ordenar por" className="flex gap-2">
          {chips.map(([s, label, value]) => (
            <Link
              key={s}
              href={sortHref(sortKey, value)}
              scroll={false}
              aria-current={sort === s ? "true" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3",
                sort === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      {report.rows.length === 0 ? (
        <Empty text={emptyText} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className={TABLE} data-testid={testId}>
            <thead className={THEAD}>
              <tr className="border-b text-left">
                <th className={TH}>Item</th>
                <th className={cn(TH, "text-right")}>Qtd.</th>
                <th className={cn(TH, "text-right")}>Atend.</th>
                {withVehicle && <th className={cn(TH, "text-right")}>Carro</th>}
                {withVehicle && <th className={cn(TH, "text-right")}>Moto</th>}
                <th className={cn(TH, "text-right")}>Valor bruto</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {report.rows.map((r) => (
                <tr key={`${r.id ?? "x"}-${r.name}`} className={TR}>
                  <td className={cn(TD_NAME, "min-w-40 max-sm:min-w-0 [overflow-wrap:anywhere]")}>{r.name}</td>
                  <td data-label="Qtd." className={cn(TD, "text-right")}>{r.quantity}</td>
                  <td data-label="Atend." className={cn(TD, "text-right")}>{r.ordersCount}</td>
                  {withVehicle && (
                    <td data-label="Carro" className={cn(TD, "text-right")}>{r.byVehicle?.car.quantity ?? "—"}</td>
                  )}
                  {withVehicle && (
                    <td data-label="Moto" className={cn(TD, "text-right")}>{r.byVehicle?.motorcycle.quantity ?? "—"}</td>
                  )}
                  <td data-label="Valor bruto" className={cn(TD, "text-right")}>
                    <Money cents={r.grossCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
