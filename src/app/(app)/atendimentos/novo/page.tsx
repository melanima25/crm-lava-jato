import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, SearchX, UserPlus } from "lucide-react";

import { ListSearch } from "@/components/list-search";
import { Money } from "@/components/money";
import { OrderBuilder } from "@/components/orders/order-builder";
import { buttonVariants } from "@/components/ui/button";
import { formatPhone } from "@/lib/format";
import { normalizePlate } from "@/lib/plate";
import { cn } from "@/lib/utils";
import { getCustomer, listCustomers } from "@/server/customers/queries";
import { listProductsForSale, listServicesForVehicleType } from "@/server/orders/queries";

export const metadata = { title: "Novo atendimento | TZ Auto Estética" };

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const MAX_RESULTS = 20;

export default async function NovoAtendimentoPage({
  searchParams,
}: PageProps<"/atendimentos/novo">) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 120);
  const customerParam = first(sp.cliente);
  const quick = first(sp.rapido) === "1";

  let body: React.ReactNode;

  if (customerParam || quick) {
    const [car, moto, products] = await Promise.all([
      listServicesForVehicleType("CAR"),
      listServicesForVehicleType("MOTORCYCLE"),
      listProductsForSale(),
    ]);
    const services = {
      CAR: car.map((s) => ({ id: s.id, name: s.name, suggestedPriceCents: s.suggestedPriceCents })),
      MOTORCYCLE: moto.map((s) => ({
        id: s.id,
        name: s.name,
        suggestedPriceCents: s.suggestedPriceCents,
      })),
    };
    let customer = null;
    if (customerParam) {
      const id = Number(customerParam);
      const found = Number.isInteger(id) ? await getCustomer(id) : null;
      if (!found || !found.active) notFound();
      customer = {
        id: found.id,
        name: found.name,
        phone: found.phone,
        debtCents: found.debtCents,
        vehicles: found.vehicles
          .filter((v) => v.active)
          .map((v) => ({
            id: v.id,
            type: v.type,
            plate: v.plate,
            brand: v.brand,
            model: v.model,
          })),
      };
    }
    body = (
      <OrderBuilder
        customer={customer}
        services={services}
        products={products}
        preferPlate={normalizePlate(q) || undefined}
      />
    );
  } else {
    const all = await listCustomers({ q });
    const customers = all.slice(0, MAX_RESULTS);
    const searching = q.trim() !== "";
    const withQ = (id: number) =>
      `/atendimentos/novo?cliente=${id}${searching ? `&q=${encodeURIComponent(q)}` : ""}`;

    body = (
      <div className="flex flex-col gap-4">
        <ListSearch
          initialQuery={q}
          initialIncludeInactive={false}
          label="Buscar cliente por nome, telefone ou placa"
          placeholder="Nome, telefone ou placa"
          showInactiveToggle={false}
          autoFocus
        />
        <Link
          href="/atendimentos/novo?rapido=1"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-12 justify-start px-4 text-base",
          )}
        >
          <UserPlus aria-hidden="true" />
          Cadastro rápido (cliente novo)
        </Link>

        {customers.length === 0 ? (
          <div
            role="status"
            className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center"
          >
            <SearchX className="size-10" aria-hidden="true" />
            <p className="text-foreground font-medium">
              {searching ? `Nenhum cliente para “${q}”` : "Nenhum cliente cadastrado ainda"}
            </p>
            <p className="text-sm">Use o cadastro rápido para atender agora.</p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {searching ? "Resultados" : "Clientes"}
              {all.length > MAX_RESULTS
                ? ` (mostrando ${MAX_RESULTS} de ${all.length}; refine a busca)`
                : ""}
            </p>
            <ul className="flex flex-col gap-2" aria-label="Clientes encontrados">
              {customers.map((c) => (
                <li key={c.id}>
                  <Link
                    href={withQ(c.id)}
                    className="bg-card hover:bg-muted/50 flex min-h-16 items-center gap-3 rounded-xl border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                        {c.debtCents > 0 && (
                          <span
                            data-testid="debt-badge"
                            className="bg-destructive/15 text-destructive inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
                          >
                            Deve <Money cents={c.debtCents} />
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {formatPhone(c.phone) || "Sem telefone"} ·{" "}
                        {c.activeVehicleCount === 1
                          ? "1 veículo"
                          : `${c.activeVehicleCount} veículos`}
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/atendimentos"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Atendimentos
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Novo atendimento</h1>
      {body}
    </div>
  );
}
