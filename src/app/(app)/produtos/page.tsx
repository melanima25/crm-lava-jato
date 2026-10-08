import Link from "next/link";
import { Package, Plus, SearchX } from "lucide-react";

import { CatalogItemActions } from "@/components/catalog/item-actions";
import { InactiveBadge } from "@/components/inactive-badge";
import { ListSearch } from "@/components/list-search";
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
import { cn } from "@/lib/utils";
import { listProducts } from "@/server/catalog/queries";

export const metadata = { title: "Produtos | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function Price({ cents }: { cents: number | null }) {
  return cents === null ? (
    <span className="text-muted-foreground">Uso interno</span>
  ) : (
    <Money cents={cents} className="font-medium" />
  );
}

export default async function ProdutosPage({ searchParams }: PageProps<"/produtos">) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 120);
  const includeInactive = first(sp.inativos) === "1";
  const products = await listProducts({ q, includeInactive });
  const searching = q.trim() !== "";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Produtos</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href="/estoque" className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}>
            Ver estoque
          </Link>
          <Link href="/produtos/novo" className={cn(buttonVariants({ size: "lg" }), "h-11 px-4")}>
            <Plus aria-hidden="true" />
            Novo produto
          </Link>
        </div>
      </header>

      <ListSearch
        initialQuery={q}
        initialIncludeInactive={includeInactive}
        label="Buscar produto por nome"
        placeholder="Nome do produto"
      />

      {products.length === 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center"
        >
          {searching ? (
            <SearchX className="size-10" aria-hidden="true" />
          ) : (
            <Package className="size-10" aria-hidden="true" />
          )}
          {searching ? (
            <>
              <p className="text-foreground font-medium">Nenhum resultado para “{q}”</p>
              <p className="text-sm">Confira o nome ou mostre os inativos.</p>
            </>
          ) : (
            <>
              <p className="text-foreground font-medium">Nenhum produto cadastrado ainda</p>
              <p className="text-sm">Cadastre o primeiro produto para começar.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {products.length === 1 ? "1 produto" : `${products.length} produtos`}
          </p>

          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Lista de produtos">
            {products.map((p) => (
              <li
                key={p.id}
                className={cn(
                  "bg-card flex flex-col gap-3 rounded-xl border p-3",
                  !p.active && "opacity-80",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{p.name}</span>
                    {!p.active && <InactiveBadge />}
                  </div>
                  {p.description && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm [overflow-wrap:anywhere]">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 text-sm">
                    <span>Unidade: {p.unit}</span>
                    <span>
                      Venda: <Price cents={p.salePriceCents} />
                    </span>
                  </div>
                </div>
                <CatalogItemActions kind="product" id={p.id} name={p.name} active={p.active} />
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Produto</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Preço de venda</TableHead>
                  <TableHead className="px-4 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id} className={cn(!p.active && "opacity-80")}>
                    <TableCell className="max-w-xs px-4 py-3 [overflow-wrap:anywhere] whitespace-normal">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/produtos/${p.id}/editar`}
                          className="font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                        {!p.active && <InactiveBadge />}
                      </div>
                      {p.description && (
                        <p className="text-muted-foreground line-clamp-2 text-sm [overflow-wrap:anywhere]">
                          {p.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{p.unit}</TableCell>
                    <TableCell>
                      <Price cents={p.salePriceCents} />
                    </TableCell>
                    <TableCell className="px-4">
                      <CatalogItemActions
                        kind="product"
                        id={p.id}
                        name={p.name}
                        active={p.active}
                        className="justify-end"
                      />
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
