import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CatalogItemActions } from "@/components/catalog/item-actions";
import { ServiceForm } from "@/components/catalog/service-form";
import { InactiveBadge } from "@/components/inactive-badge";
import { getService } from "@/server/catalog/queries";

export const metadata = { title: "Editar serviço | TZ Auto Estética" };

export default async function EditarServicoPage({ params }: PageProps<"/servicos/[id]/editar">) {
  const { id } = await params;
  const serviceId = Number(id);
  const service = Number.isInteger(serviceId) ? await getService(serviceId) : null;
  if (!service) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link
        href="/servicos"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Serviços
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Editar serviço</h1>
        {!service.active && <InactiveBadge />}
      </div>
      <ServiceForm service={service} />
      <section className="flex flex-col gap-2 border-t pt-4" aria-label="Outras ações">
        <p className="text-muted-foreground text-sm">
          Inativar tira o serviço de novos atendimentos e pode ser desfeito. Excluir é definitivo.
        </p>
        <CatalogItemActions
          kind="service"
          id={service.id}
          name={service.name}
          active={service.active}
          showEdit={false}
        />
      </section>
    </div>
  );
}
