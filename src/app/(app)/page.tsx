import Link from "next/link";
import { CarFront, Package, Plus, Users, Wallet } from "lucide-react";

import { Money } from "@/components/money";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatYmdBR, ymdBR } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getDayCash, listDebtors, listOrders } from "@/server/orders/queries";
import { getLowStock } from "@/server/stock/queries";

const atalhos = [
  { href: "/atendimentos", label: "Atendimentos", icon: CarFront },
  { href: "/caixa", label: "Caixa do dia", icon: Wallet },
  { href: "/clientes", label: "Clientes", icon: Users },
];

export default async function Home() {
  const today = ymdBR();
  const [orders, cash, debtors, lowStock] = await Promise.all([
    listOrders({ date: today }),
    getDayCash({ date: today }),
    listDebtors(),
    getLowStock(),
  ]);
  const active = orders.filter((o) => o.status !== "CANCELED");
  const open = orders.filter((o) => o.status === "OPEN").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo</h1>
        <p className="text-muted-foreground mt-1 text-sm">Resumo de hoje, {formatYmdBR(today)}.</p>
      </header>

      <Link
        href="/atendimentos/novo"
        className={cn(buttonVariants({ size: "lg" }), "h-14 w-full text-lg md:w-fit md:px-8")}
      >
        <Plus className="size-5" aria-hidden="true" />
        Novo atendimento
      </Link>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="bg-card rounded-xl border p-3">
          <dt className="text-muted-foreground text-xs">Atendimentos hoje</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {active.length}
            {open > 0 && (
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                ({open} em andamento)
              </span>
            )}
          </dd>
        </div>
        <div className="bg-card rounded-xl border p-3">
          <dt className="text-muted-foreground text-xs">Recebido hoje</dt>
          <dd className="text-xl font-semibold">
            <Money cents={cash.totalCents} />
          </dd>
        </div>
        <div className="bg-card hover:bg-muted/50 relative col-span-2 rounded-xl border p-3 lg:col-span-1">
          <dt className="text-muted-foreground text-xs">Fiado em aberto</dt>
          <dd className="text-xl font-semibold" data-testid="home-fiado">
            <Link href="/fiado" className="after:absolute after:inset-0 after:rounded-xl">
              <Money cents={debtors.grandTotalCents} />
            </Link>
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {atalhos.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="hover:bg-muted/50 rounded-xl">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex min-h-8 items-center gap-2">
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
        <Link
          href={lowStock.count > 0 ? "/estoque?baixo=1" : "/estoque"}
          data-testid="home-estoque"
          className="hover:bg-muted/50 col-span-2 rounded-xl lg:col-span-1"
        >
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="size-4" aria-hidden="true" />
                Estoque baixo
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs">
              {lowStock.count === 0 ? (
                <span className="text-muted-foreground">Estoque em dia</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-amber-300">
                    {lowStock.count === 1 ? "1 produto" : `${lowStock.count} produtos`}
                  </span>
                  <ul className="text-muted-foreground flex flex-col gap-0.5">
                    {lowStock.items.slice(0, 3).map((i) => (
                      <li key={i.id} className="[overflow-wrap:anywhere]">
                        {i.name}: {i.stockQuantity} {i.unit} (mín. {i.minStockQuantity})
                      </li>
                    ))}
                    {lowStock.count > 3 && <li>e mais {lowStock.count - 3}</li>}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
