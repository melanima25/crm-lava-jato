import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CatalogItemActions } from "@/components/catalog/item-actions";
import { ProductForm } from "@/components/catalog/product-form";
import { InactiveBadge } from "@/components/inactive-badge";
import { getProduct } from "@/server/catalog/queries";

export const metadata = { title: "Editar produto | TZ Auto Estética" };

export default async function EditarProdutoPage({ params }: PageProps<"/produtos/[id]/editar">) {
  const { id } = await params;
  const productId = Number(id);
  const product = Number.isInteger(productId) ? await getProduct(productId) : null;
  if (!product) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link
        href="/produtos"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Produtos
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Editar produto</h1>
        {!product.active && <InactiveBadge />}
      </div>
      <ProductForm product={product} />
      <Link
        href={`/estoque/${product.id}`}
        className="text-muted-foreground hover:text-foreground inline-flex min-h-10 w-fit items-center text-sm underline"
      >
        Ver estoque deste produto
      </Link>
      <section className="flex flex-col gap-2 border-t pt-4" aria-label="Outras ações">
        <p className="text-muted-foreground text-sm">
          Inativar tira o produto de novos atendimentos e pode ser desfeito. Excluir é definitivo.
        </p>
        <CatalogItemActions
          kind="product"
          id={product.id}
          name={product.name}
          active={product.active}
          showEdit={false}
        />
      </section>
    </div>
  );
}
