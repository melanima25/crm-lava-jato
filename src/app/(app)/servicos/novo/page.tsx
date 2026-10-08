import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ServiceForm } from "@/components/catalog/service-form";

export const metadata = { title: "Novo serviço | TZ Auto Estética" };

export default function NovoServicoPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link
        href="/servicos"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Serviços
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Novo serviço</h1>
      <ServiceForm />
    </div>
  );
}
