"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CarFront,
  Ellipsis,
  HandCoins,
  House,
  LogOut,
  Package,
  ShoppingBag,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { logout } from "@/server/auth/actions";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: typeof House;
  ready: boolean;
  /** Aparece na barra inferior do celular; os demais ficam no "Mais". */
  mobile: boolean;
};

// `ready: false` = módulo ainda não implementado (visível, porém desabilitado).
const ITEMS: Item[] = [
  { href: "/", label: "Início", icon: House, ready: true, mobile: true },
  { href: "/atendimentos", label: "Atendimentos", icon: CarFront, ready: true, mobile: true },
  { href: "/clientes", label: "Clientes", icon: Users, ready: true, mobile: true },
  { href: "/caixa", label: "Caixa", icon: Wallet, ready: true, mobile: true },
  { href: "/fiado", label: "Fiado", icon: HandCoins, ready: true, mobile: false },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, ready: true, mobile: false },
  { href: "/servicos", label: "Serviços", icon: Wrench, ready: true, mobile: false },
  { href: "/produtos", label: "Produtos", icon: ShoppingBag, ready: true, mobile: false },
  { href: "/estoque", label: "Estoque", icon: Package, ready: true, mobile: false },
];

const MORE_ITEMS = ITEMS.filter((i) => !i.mobile);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const itemBase = cn(
  "flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium",
  "md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2 md:text-sm",
);

export function AppNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((i) => i.ready && isActive(pathname, i.href));

  return (
    <>
      {/* Topo (celular): marca + Sair */}
      <header className="bg-sidebar flex h-12 items-center justify-between border-b px-4 md:hidden">
        <BrandMark size="sm" />
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut aria-hidden="true" />
            Sair
          </Button>
        </form>
      </header>

      <nav
        aria-label="Navegação principal"
        className={cn(
          "bg-sidebar fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t pb-[env(safe-area-inset-bottom)]",
          "md:sticky md:inset-x-auto md:top-0 md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-1 md:border-t-0 md:border-r md:p-3",
        )}
      >
        <div className="hidden px-3 pt-4 pb-6 md:block">
          <BrandMark size="md" />
        </div>
        {ITEMS.map(({ href, label, icon: Icon, ready, mobile }) => {
          const active = ready && isActive(pathname, href);
          // Atendimentos é o destaque do balcão no celular (ícone em círculo).
          const highlight = href === "/atendimentos";
          const content = (
            <>
              <span
                className={cn(
                  highlight &&
                    "bg-silver text-primary-foreground -mt-3 rounded-full p-2.5 shadow-md shadow-black/60 md:mt-0 md:rounded-none md:bg-transparent md:bg-none md:p-0 md:text-inherit md:shadow-none",
                )}
              >
                <Icon className="size-5 md:size-4" aria-hidden="true" />
              </span>
              <span>{label}</span>
            </>
          );
          if (!ready) {
            return (
              <span
                key={href}
                aria-disabled="true"
                title="Em breve"
                // Itens "em breve" ficam só no menu lateral do desktop (no celular, no "Mais").
                className={cn(
                  itemBase,
                  "text-muted-foreground/50 hidden cursor-not-allowed md:flex",
                )}
              >
                {content}
                <span className="sr-only">(em breve)</span>
                <span
                  aria-hidden="true"
                  className="bg-muted hidden rounded px-1.5 text-[10px] md:ml-auto md:inline"
                >
                  em breve
                </span>
              </span>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                itemBase,
                !mobile && "hidden md:flex",
                active
                  ? "text-primary md:bg-muted md:shadow-[inset_2px_0_0_var(--primary)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {content}
            </Link>
          );
        })}

        {/* Celular: "Mais" reúne Fiado, Relatórios, Serviços, Produtos e Estoque */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            itemBase,
            "md:hidden",
            moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Ellipsis className="size-5" aria-hidden="true" />
          <span>Mais</span>
        </button>

        <form action={logout} className="mt-auto hidden md:block">
          <Button type="submit" variant="ghost" className="w-full justify-start gap-3 px-3">
            <LogOut aria-hidden="true" />
            Sair
          </Button>
        </form>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="md:hidden">
          <DialogHeader>
            <DialogTitle>Mais</DialogTitle>
            <DialogDescription className="sr-only">Outras áreas do sistema</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {MORE_ITEMS.map(({ href, label, icon: Icon, ready }) => (
              <li key={href}>
                {ready ? (
                  <Link
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={isActive(pathname, href) ? "page" : undefined}
                    className="hover:bg-muted flex min-h-12 items-center gap-3 rounded-lg border px-3 text-base font-medium"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="text-muted-foreground/60 flex min-h-12 items-center gap-3 rounded-lg border border-dashed px-3 text-base"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {label}
                    <span className="bg-muted ml-auto rounded px-1.5 text-xs">em breve</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
