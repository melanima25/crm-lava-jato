import Link from "next/link";
import { Plus, SearchX, Wrench } from "lucide-react";

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
import { listServices } from "@/server/catalog/queries";

export const metadata = { title: "Serviços | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function Price({ cents }: { cents: number | null }) {
  return cents === null ? (
    <span className="text-muted-foreground">Não oferece</span>
  ) : (
    <Money cents={cents} className="font-medium" />
  );
}

export default async function ServicosPage({ searchParams }: PageProps<"/servicos">) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 120);
  const includeInactive = first(sp.inativos) === "1";
  const services = await listServices({ q, includeInactive });
  const searching = q.trim() !== "";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Serviços</h1>
        <Link href="/servicos/novo" className={cn(buttonVariants({ size: "lg" }), "h-11 px-4")}>
          <Plus aria-hidden="true" />
          Novo serviço
        </Link>
      </header>

      <ListSearch
        initialQuery={q}
        initialIncludeInactive={includeInactive}
        label="Buscar serviço por nome"
        placeholder="Nome do serviço"
      />

      {services.length === 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center"
        >
          {searching ? (
            <SearchX className="size-10" aria-hidden="true" />
          ) : (
            <Wrench className="size-10" aria-hidden="true" />
          )}
          {searching ? (
            <>
              <p className="text-foreground font-medium">Nenhum resultado para “{q}”</p>
              <p className="text-sm">Confira o nome ou mostre os inativos.</p>
            </>
          ) : (
            <>
              <p className="text-foreground font-medium">Nenhum serviço cadastrado ainda</p>
              <p className="text-sm">Cadastre o primeiro serviço para começar.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {services.length === 1 ? "1 serviço" : `${services.length} serviços`}
          </p>

          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Lista de serviços">
            {services.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "bg-card flex flex-col gap-3 rounded-xl border p-3",
                  !s.active && "opacity-80",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{s.name}</span>
                    {!s.active && <InactiveBadge />}
                  </div>
                  {s.description && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm [overflow-wrap:anywhere]">
                      {s.description}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 text-sm">
                    <span>
                      Carro: <Price cents={s.carPriceCents} />
                    </span>
                    <span>
                      Moto: <Price cents={s.motorcyclePriceCents} />
                    </span>
                  </div>
                </div>
                <CatalogItemActions kind="service" id={s.id} name={s.name} active={s.active} />
              </li>
            ))}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Serviço</TableHead>
                  <TableHead>Carro</TableHead>
                  <TableHead>Moto</TableHead>
                  <TableHead className="px-4 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((s) => (
                  <TableRow key={s.id} className={cn(!s.active && "opacity-80")}>
                    <TableCell className="max-w-xs px-4 py-3 [overflow-wrap:anywhere] whitespace-normal">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/servicos/${s.id}/editar`}
                          className="font-medium hover:underline"
                        >
                          {s.name}
                        </Link>
                        {!s.active && <InactiveBadge />}
                      </div>
                      {s.description && (
                        <p className="text-muted-foreground line-clamp-2 text-sm [overflow-wrap:anywhere]">
                          {s.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Price cents={s.carPriceCents} />
                    </TableCell>
                    <TableCell>
                      <Price cents={s.motorcyclePriceCents} />
                    </TableCell>
                    <TableCell className="px-4">
                      <CatalogItemActions
                        kind="service"
                        id={s.id}
                        name={s.name}
                        active={s.active}
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
