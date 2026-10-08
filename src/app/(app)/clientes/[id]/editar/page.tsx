import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CustomerForm } from "@/components/customers/customer-form";
import { getCustomer } from "@/server/customers/queries";

export const metadata = { title: "Editar cliente | TZ Auto Estética" };

export default async function EditarClientePage({ params }: PageProps<"/clientes/[id]/editar">) {
  const { id } = await params;
  const customer = await getCustomer(Number(id));
  if (!customer) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link
        href={`/clientes/${customer.id}`}
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {customer.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Editar cliente</h1>
      <CustomerForm customer={customer} />
    </div>
  );
}
