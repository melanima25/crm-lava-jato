"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 300;

export function ListSearch({
  initialQuery,
  initialIncludeInactive,
  label,
  placeholder,
  showInactiveToggle = true,
  autoFocus = false,
}: {
  initialQuery: string;
  initialIncludeInactive: boolean;
  /** Rótulo acessível do campo de busca. */
  label: string;
  placeholder: string;
  /** Oculta "Mostrar inativos" (ex.: novo atendimento só aceita clientes ativos). */
  showInactiveToggle?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const [includeInactive, setIncludeInactive] = useState(initialIncludeInactive);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigate(nextQ: string, nextInactive: boolean) {
    // Preserva outros filtros da URL (ex.: ?ordem= em /fiado); só q/inativos são recalculados.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("inativos");
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextInactive) params.set("inativos", "1");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onQueryChange(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate(value, includeInactive), DEBOUNCE_MS);
  }

  function clear() {
    setQ("");
    if (timer.current) clearTimeout(timer.current);
    navigate("", includeInactive);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <Input
          type="search"
          role="searchbox"
          aria-label={label}
          placeholder={placeholder}
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          autoComplete="off"
          autoFocus={autoFocus}
          className="h-12 pr-12 pl-10 text-base [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-1 -translate-y-1/2">
          {pending ? (
            <Loader2
              aria-label="Buscando"
              className="text-muted-foreground mr-2.5 size-5 animate-spin"
            />
          ) : q ? (
            <Button type="button" variant="ghost" size="icon-lg" onClick={clear}>
              <X aria-hidden="true" />
              <span className="sr-only">Limpar busca</span>
            </Button>
          ) : null}
        </div>
      </div>
      {showInactiveToggle && (
        <label className="flex min-h-10 w-fit cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              navigate(q, e.target.checked);
            }}
            className="accent-primary size-5"
          />
          Mostrar inativos
        </label>
      )}
    </div>
  );
}
