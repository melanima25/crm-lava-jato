import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Lock,
  Scale,
  ShoppingCart,
} from "lucide-react";

import { InactiveBadge } from "@/components/inactive-badge";
import { MovementActions } from "@/components/stock/movement-actions";
import { StockQuickActions } from "@/components/stock/quick-actions";
import { LowStockBadge, StockQuantity } from "@/components/stock/stock-badges";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTimeBR, ymdBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { getProductStock, type StockMovementDTO } from "@/server/stock/queries";

export const metadata = { title: "Estoque do produto | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const TYPE_UI = {
  IN: { label: "Entrada", icon: ArrowDownToLine, color: "text-emerald-400" },
  OUT: { label: "Baixa", icon: ArrowUpFromLine, color: "text-destructive" },
  ADJUSTMENT: { label: "Acerto", icon: Scale, color: "text-amber-300" },
  SALE: { label: "Venda", icon: ShoppingCart, color: "text-slate-300" },
} as const;

function signed(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}

function Movement({
  m,
  product,
}: {
  m: StockMovementDTO;
  product: { id: number; name: string; unit: string; stockQuantity: number };
}) {
  const ui = TYPE_UI[m.type];
  const Icon = ui.icon;
  return (
    <li
      data-testid="movement-row"
      data-type={m.type}
      className="bg-card flex flex-col gap-2 rounded-xl border p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("flex items-center gap-2 font-semibold", ui.color)}>
            <Icon className="size-4" aria-hidden="true" />
            <span>{ui.label}</span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{formatDateTimeBR(m.occurredAt)}</p>
        </div>
        <div className="text-right">
          <div
            data-testid="movement-delta"
            className={cn("text-2xl font-semibold tabular-nums", ui.color)}
          >
            {signed(m.quantity)}
          </div>
          <div className="text-muted-foreground text-xs">
            Saldo: <span className="tabular-nums">{m.balanceAfter}</span> {product.unit}
          </div>
        </div>
      </div>

      {m.type === "SALE" && m.orderId !== null && (
        <p className="text-sm">
          <Link href={`/atendimentos/${m.orderId}`} className="font-medium hover:underline">
            Venda — OS nº {m.orderId}
          </Link>
        </p>
      )}
      {m.reason && <p className="text-sm [overflow-wrap:anywhere]">{m.reason}</p>}
      {m.cashEntry && (
        <p className="text-muted-foreground text-sm">
          <Link href={`/caixa?data=${ymdBR(m.occurredAt)}`} className="hover:underline">
            Compra {formatBRL(m.cashEntry.amountCents)} • {PAYMENT_METHOD_LABEL[m.cashEntry.method]}
          </Link>
        </p>
      )}

      {m.editable && m.type !== "SALE" ? (
        <MovementActions
          product={product}
          movement={{
            id: m.id,
            type: m.type,
            quantity: m.quantity,
            reason: m.reason,
            occurredAt: m.occurredAt,
            cashEntry: m.cashEntry,
          }}
        />
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Lock className="size-3.5" aria-hidden="true" />
          {m.lockedReason ?? "Esta movimentação não pode ser alterada aqui"}
        </p>
      )}
    </li>
  );
}

export default async function EstoqueProdutoPage({
  params,
  searchParams,
}: PageProps<"/estoque/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const productId = Number(id);
  const page = Number(first(sp.pagina)) || 1;
  const history = Number.isInteger(productId) ? await getProductStock(productId, { page }) : null;
  if (!history) notFound();
  const { product, movements, pageCount } = history;
  const current = history.page;
  const href = (p: number) => `/estoque/${product.id}?pagina=${p}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link
        href="/estoque"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Estoque
      </Link>

      <section className="bg-card flex flex-col gap-4 rounded-xl border p-4" aria-label="Produto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
              {product.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {!product.active && <InactiveBadge />}
              {product.low && <LowStockBadge />}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Unidade: {product.unit} ·{" "}
              {product.minStockQuantity !== null
                ? `Mínimo: ${product.minStockQuantity} ${product.unit}`
                : "Sem estoque mínimo"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-muted-foreground text-xs">Quantidade atual</div>
            <StockQuantity
              quantity={product.stockQuantity}
              unit={product.unit}
              low={product.low}
              size="lg"
            />
          </div>
        </div>
        <StockQuickActions
          product={product}
          active={product.active}
          showAdjust
          large
          initialKind={first(sp.acertar) === "1" ? "adjust" : null}
        />
        {!product.active && (
          <p className="text-muted-foreground text-sm">
            Produto inativo: entrada e baixa estão bloqueadas; o acerto de inventário continua
            disponível.
          </p>
        )}
        <Link
          href={`/produtos/${product.id}/editar`}
          className={cn(buttonVariants({ variant: "ghost" }), "h-10 w-fit px-3 text-sm")}
        >
          Editar cadastro do produto
        </Link>
      </section>

      <section className="flex flex-col gap-3" aria-label="Histórico de movimentações">
        <h2 className="text-lg font-semibold">Histórico</h2>
        {movements.length === 0 ? (
          <p
            role="status"
            className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm"
          >
            Nenhuma movimentação ainda. Registre uma entrada para começar.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {movements.map((m) => (
              <Movement key={m.id} m={m} product={product} />
            ))}
          </ul>
        )}

        {pageCount > 1 && (
          <nav aria-label="Paginação" className="flex items-center justify-between gap-2">
            {current > 1 ? (
              <Link
                href={href(current - 1)}
                className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}
              >
                Anterior
              </Link>
            ) : (
              <span className="w-24" />
            )}
            <span className="text-muted-foreground text-sm">
              Página {current} de {pageCount}
            </span>
            {current < pageCount ? (
              <Link
                href={href(current + 1)}
                className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}
              >
                Próxima
              </Link>
            ) : (
              <span className="w-24" />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
