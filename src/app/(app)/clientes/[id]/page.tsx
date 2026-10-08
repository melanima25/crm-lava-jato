import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Pencil, Phone } from "lucide-react";

import { ReceiveButton } from "@/components/debt/receive-button";
import { CustomerActiveToggle } from "@/components/customers/customer-active-toggle";
import { CustomerDeleteButton } from "@/components/customers/customer-delete-button";
import { InactiveBadge } from "@/components/inactive-badge";
import { Money } from "@/components/money";
import { VehicleList } from "@/components/customers/vehicle-list";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateBR } from "@/lib/dates";
import { formatPhone } from "@/lib/format";
import { vehicleLabel } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { getCustomer } from "@/server/customers/queries";
import { getCustomerDebt } from "@/server/orders/queries";

export const metadata = { title: "Cliente | TZ Auto Estética" };

export default async function ClienteDetalhePage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  const customerId = Number(id);
  const customer = Number.isInteger(customerId) ? await getCustomer(customerId) : null;
  if (!customer) notFound();
  const debt = customer.debtCents > 0 ? await getCustomerDebt(customer.id) : null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/clientes"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Clientes
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {customer.name}
            </h1>
            {!customer.active && <InactiveBadge />}
          </div>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
            <Phone className="size-4" aria-hidden="true" />
            {formatPhone(customer.phone) || "Sem telefone"}
          </p>
          {customer.notes && <p className="mt-2 text-sm whitespace-pre-line">{customer.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/clientes/${customer.id}/editar`}
            className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}
          >
            <Pencil aria-hidden="true" />
            Editar
          </Link>
          <CustomerActiveToggle
            customerId={customer.id}
            name={customer.name}
            active={customer.active}
          />
          <CustomerDeleteButton customerId={customer.id} name={customer.name} />
        </div>
      </header>

      {debt && debt.balanceCents > 0 && (
        <section
          aria-labelledby="sec-saldo-devedor"
          data-testid="customer-debt"
          className="bg-card border-destructive/40 flex flex-col gap-3 rounded-xl border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="sec-saldo-devedor" className="text-muted-foreground text-sm font-medium">
                Saldo devedor
              </h2>
              <p
                className="text-destructive text-3xl font-semibold"
                data-testid="customer-debt-total"
              >
                <Money cents={debt.balanceCents} />
              </p>
              <p className="text-muted-foreground text-xs">
                {debt.pendingCount === 1 ? "1 atendimento" : `${debt.pendingCount} atendimentos`}
                {debt.oldestPendingAt && <> · desde {formatDateBR(debt.oldestPendingAt)}</>}
              </p>
            </div>
            <ReceiveButton
              size="lg"
              className="h-12 w-full px-6 text-base sm:w-auto"
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
          </div>
          <ul className="flex flex-col gap-2" aria-label="Atendimentos pendentes">
            {debt.orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/atendimentos/${o.id}`}
                  className="bg-background hover:bg-muted/50 flex min-h-16 items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Atendimento #{o.id}</span>
                      <OrderStatusBadge status="DONE" paymentStatus={o.paymentStatus} />
                    </div>
                    <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
                      {formatDateBR(o.occurredAt)} · {vehicleLabel(o.vehicle)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Total <Money cents={o.totalCents} /> · Pago <Money cents={o.paidCents} />
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground text-xs">Saldo</p>
                    <Money cents={o.balanceCents} className="text-destructive font-semibold" />
                  </div>
                  <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <VehicleList
        customerId={customer.id}
        customerActive={customer.active}
        vehicles={customer.vehicles}
      />
    </div>
  );
}
