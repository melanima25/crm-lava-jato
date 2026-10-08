import Link from "next/link";
import { Package, Plus, SearchX } from "lucide-react";

import { InactiveBadge } from "@/components/inactive-badge";
import { ListSearch } from "@/components/list-search";
import { StockQuickActions } from "@/components/stock/quick-actions";
import { LowStockBadge, StockQuantity } from "@/components/stock/stock-badges";
import { LowOnlyToggle } from "@/components/stock/stock-filters";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { listStock } from "@/server/stock/queries";

export const metadata = { title: "Estoque | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function EstoquePage({ searchParams }: PageProps<"/estoque">) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 120);
  const includeInactive = first(sp.inativos) === "1";
  const lowOnly = first(sp.baixo) === "1";
  const products = await listStock({ q, includeInactive, lowOnly });
  const filtering = q.trim() !== "" || lowOnly;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Estoque</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/produtos"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}
          >
            Gerenciar produtos
          </Link>
          <Link href="/produtos/novo" className={cn(buttonVariants({ size: "lg" }), "h-11 px-4")}>
            <Plus aria-hidden="true" />
            Cadastrar produto
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <ListSearch
          initialQuery={q}
          initialIncludeInactive={includeInactive}
          label="Buscar produto por nome"
          placeholder="Nome do produto"
        />
        <LowOnlyToggle checked={lowOnly} />
      </div>

      {products.length === 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center"
        >
          {filtering ? (
            <SearchX className="size-10" aria-hidden="true" />
          ) : (
            <Package className="size-10" aria-hidden="true" />
          )}
          {lowOnly && q.trim() === "" ? (
            <>
              <p className="text-foreground font-medium">Nenhum produto com estoque baixo</p>
              <p className="text-sm">Estoque em dia.</p>
            </>
          ) : filtering ? (
            <>
              <p className="text-foreground font-medium">Nenhum resultado para “{q}”</p>
              <p className="text-sm">Confira o nome ou mostre os inativos.</p>
            </>
          ) : (
            <>
              <p className="text-foreground font-medium">Nenhum produto cadastrado ainda</p>
              <p className="text-sm">Cadastre um produto para controlar o estoque.</p>
              <Link
                href="/produtos/novo"
                className={cn(buttonVariants({ variant: "outline" }), "mt-2 h-11 px-4")}
              >
                Cadastrar produto
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {products.length === 1 ? "1 produto" : `${products.length} produtos`}
          </p>

          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Lista de estoque">
            {products.map((p) => (
              <li
                key={p.id}
                data-testid="stock-row"
                className={cn(
                  "bg-card flex flex-col gap-3 rounded-xl border p-3",
                  !p.active && "opacity-80",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/estoque/${p.id}`}
                      className="font-medium [overflow-wrap:anywhere] hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {!p.active && <InactiveBadge />}
                      {p.low && <LowStockBadge />}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {p.minStockQuantity !== null
                        ? `Mínimo: ${p.minStockQuantity} ${p.unit}`
                        : "Sem estoque mínimo"}
                    </p>
                  </div>
                  <StockQuantity quantity={p.stockQuantity} unit={p.unit} low={p.low} />
                </div>
                <StockQuickActions product={p} active={p.active} />
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Produto</TableHead>
                  <TableHead className="text-right">Quantidade atual</TableHead>
                  <TableHead>Mínimo</TableHead>
                  <TableHead className="px-4 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow
                    key={p.id}
                    data-testid="stock-row"
                    className={cn(!p.active && "opacity-80")}
                  >
                    <TableCell className="max-w-xs px-4 py-3 [overflow-wrap:anywhere] whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/estoque/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {!p.active && <InactiveBadge />}
                        {p.low && <LowStockBadge />}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <StockQuantity quantity={p.stockQuantity} unit={p.unit} low={p.low} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.minStockQuantity !== null ? `${p.minStockQuantity} ${p.unit}` : "—"}
                    </TableCell>
                    <TableCell className="px-4">
                      <StockQuickActions product={p} active={p.active} className="justify-end" />
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
