import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { CustomerForm } from "@/components/customers/customer-form";

export const metadata = { title: "Novo cliente | TZ Auto Estética" };

export default function NovoClientePage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link
        href="/clientes"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Clientes
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Novo cliente</h1>
      <CustomerForm />
    </div>
  );
}
