import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CarFront, Phone, User } from "lucide-react";

import { Money } from "@/components/money";
import { OrderActions } from "@/components/orders/order-actions";
import { OrderItems } from "@/components/orders/order-items";
import { OrderPayments } from "@/components/orders/order-payments";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { formatDateTimeBR } from "@/lib/dates";
import { formatPhone } from "@/lib/format";
import { vehicleLabel } from "@/lib/order-ui";
import { getOrder, listProductsForSale, listServicesForVehicleType } from "@/server/orders/queries";

export const metadata = { title: "Atendimento | TZ Auto Estética" };

export default async function AtendimentoDetalhePage({ params }: PageProps<"/atendimentos/[id]">) {
  const { id } = await params;
  const orderId = Number(id);
  const order = Number.isInteger(orderId) ? await getOrder(orderId) : null;
  if (!order) notFound();

  const services =
    order.vehicle && order.status !== "CANCELED"
      ? (await listServicesForVehicleType(order.vehicle.type)).map((s) => ({
          id: s.id,
          name: s.name,
          suggestedPriceCents: s.suggestedPriceCents,
        }))
      : [];
  const products = order.status !== "CANCELED" ? await listProductsForSale() : [];

  const owes = order.status === "DONE" && order.balanceCents > 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/atendimentos"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Atendimentos
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Atendimento #{order.id}</h1>
          <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} />
        </div>
        <p className="text-muted-foreground text-sm">{formatDateTimeBR(order.occurredAt)}</p>
        <div className="flex flex-col gap-1 text-sm">
          <Link
            href={`/clientes/${order.customer.id}`}
            className="inline-flex min-h-8 w-fit items-center gap-2 font-medium [overflow-wrap:anywhere] hover:underline"
          >
            <User className="size-4 shrink-0" aria-hidden="true" />
            {order.customer.name}
          </Link>
          {order.customer.phone && (
            <span className="text-muted-foreground inline-flex items-center gap-2">
              <Phone className="size-4" aria-hidden="true" />
              {formatPhone(order.customer.phone)}
            </span>
          )}
          <Link
            href={`/clientes/${order.customer.id}`}
            className="text-muted-foreground inline-flex min-h-8 w-fit items-center gap-2 [overflow-wrap:anywhere] hover:underline"
          >
            <CarFront className="size-4 shrink-0" aria-hidden="true" />
            {vehicleLabel(order.vehicle)}
          </Link>
        </div>
      </header>

      <section aria-label="Valores" className="bg-card flex flex-col gap-1.5 rounded-xl border p-4">
        <div className="text-muted-foreground flex justify-between text-sm">
          <span>Subtotal</span>
          <Money cents={order.subtotalCents} />
        </div>
        {order.discountCents > 0 && (
          <div className="text-muted-foreground flex justify-between text-sm">
            <span>Desconto</span>
            <span className="tabular-nums">
              − <Money cents={order.discountCents} />
            </span>
          </div>
        )}
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span data-testid="order-total">
            <Money cents={order.totalCents} />
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Pago</span>
          <span data-testid="order-paid">
            <Money cents={order.paidCents} />
          </span>
        </div>
        {order.status !== "CANCELED" && (
          <div
            className={`flex justify-between text-sm font-medium ${owes ? "text-destructive" : ""}`}
          >
            <span>Saldo</span>
            <span data-testid="order-balance">
              <Money cents={order.balanceCents} />
            </span>
          </div>
        )}
      </section>

      <OrderActions
        orderId={order.id}
        status={order.status}
        totalCents={order.totalCents}
        balanceCents={order.balanceCents}
        subtotalCents={order.subtotalCents}
        discountCents={order.discountCents}
        notes={order.notes}
        hasItems={order.items.length > 0}
      />

      <OrderItems
        orderId={order.id}
        status={order.status}
        items={order.items}
        services={services}
        products={products}
      />

      {order.notes && (
        <section aria-labelledby="sec-obs" className="flex flex-col gap-1">
          <h2 id="sec-obs" className="text-lg font-semibold">
            Observação
          </h2>
          <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-line">{order.notes}</p>
        </section>
      )}

      <OrderPayments payments={order.payments} canRefund={order.status !== "CANCELED"} />
    </div>
  );
}
