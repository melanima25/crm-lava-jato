import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProductForm } from "@/components/catalog/product-form";

export const metadata = { title: "Novo produto | TZ Auto Estética" };

export default function NovoProdutoPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link
        href="/produtos"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Produtos
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Novo produto</h1>
      <ProductForm />
    </div>
  );
}
