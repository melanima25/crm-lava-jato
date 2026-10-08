import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { CategoryManager } from "@/components/cash/category-manager";
import { listCashCategories } from "@/server/cash/queries";

export const metadata = { title: "Categorias do caixa | TZ Auto Estética" };

export default async function CategoriasPage() {
  const categories = await listCashCategories({ includeInactive: true });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          href="/caixa"
          className="text-muted-foreground hover:text-foreground inline-flex min-h-11 w-fit items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Voltar ao caixa
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Categorias do caixa</h1>
        <p className="text-muted-foreground text-sm">
          Organize entradas e saídas. Categorias com lançamentos não podem ser excluídas, mas podem
          ser inativadas.
        </p>
      </header>
      <CategoryManager categories={categories} />
    </div>
  );
}
