import Link from "next/link";
import { CarFront, ChevronRight, Plus, SearchX, Users } from "lucide-react";

import { CustomerSearch } from "@/components/customers/customer-search";
import { InactiveBadge } from "@/components/inactive-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listCustomers } from "@/server/customers/queries";

export const metadata = { title: "Clientes | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function vehiclesLabel(n: number) {
  return n === 1 ? "1 veículo" : `${n} veículos`;
}

export default async function ClientesPage({ searchParams }: PageProps<"/clientes">) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 120);
  const includeInactive = first(sp.inativos) === "1";
  const customers = await listCustomers({ q, includeInactive });
  const searching = q.trim() !== "";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <Link href="/clientes/novo" className={cn(buttonVariants({ size: "lg" }), "h-11 px-4")}>
          <Plus aria-hidden="true" />
          Novo cliente
        </Link>
      </header>

      <CustomerSearch initialQuery={q} initialIncludeInactive={includeInactive} />

      {customers.length === 0 ? (
        <div
          role="status"
          className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center"
        >
          {searching ? (
            <SearchX className="size-10" aria-hidden="true" />
          ) : (
            <Users className="size-10" aria-hidden="true" />
          )}
          {searching ? (
            <>
              <p className="text-foreground font-medium">Nenhum resultado para “{q}”</p>
              <p className="text-sm">
                Confira o nome, o telefone ou a placa, ou mostre os inativos.
              </p>
            </>
          ) : (
            <>
              <p className="text-foreground font-medium">Nenhum cliente cadastrado ainda</p>
              <p className="text-sm">Cadastre o primeiro cliente para começar.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {customers.length === 1 ? "1 cliente" : `${customers.length} clientes`}
          </p>

          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Lista de clientes">
            {customers.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className={cn(
                    "bg-card hover:bg-muted/50 flex min-h-16 items-center gap-3 rounded-xl border p-3",
                    !c.active && "opacity-70",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{c.name}</span>
                      {!c.active && <InactiveBadge />}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 text-sm">
                      <span>{formatPhone(c.phone) || "Sem telefone"}</span>
                      <span className="inline-flex items-center gap-1">
                        <CarFront className="size-3.5" aria-hidden="true" />
                        {vehiclesLabel(c.activeVehicleCount)}
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
                  <TableHead className="px-4">Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Veículos ativos</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} className={cn(!c.active && "opacity-70")}>
                    <TableCell className="px-4 py-3 [overflow-wrap:anywhere] whitespace-normal">
                      <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {!c.active && (
                        <span className="ml-2">
                          <InactiveBadge />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatPhone(c.phone) || "—"}</TableCell>
                    <TableCell>{c.activeVehicleCount}</TableCell>
                    <TableCell>
                      <Link href={`/clientes/${c.id}`} aria-label={`Abrir ${c.name}`}>
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
