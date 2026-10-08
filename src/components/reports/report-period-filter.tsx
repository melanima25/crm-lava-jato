"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { addDaysYmd } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type ReportPeriodMode = "hoje" | "semana" | "mes" | "mes-passado" | "personalizado";

const OPTIONS: [ReportPeriodMode, string][] = [
  ["hoje", "Hoje"],
  ["semana", "Semana"],
  ["mes", "Mês"],
  ["mes-passado", "Mês passado"],
  ["personalizado", "Personalizado"],
];

const chipClass = (active: boolean) =>
  cn(
    "focus-visible:ring-ring/50 min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3",
    active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
  );

/**
 * Seletor de período dos relatórios. URL: ?periodo=hoje|semana|mes|mes-passado|personalizado
 * (+ &de=yyyy-mm-dd&ate=yyyy-mm-dd no personalizado). Preserva os demais parâmetros (ordenações).
 */
export function ReportPeriodFilter({
  mode,
  from,
  to,
  today,
}: {
  mode: ReportPeriodMode;
  from: string;
  to: string;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [de, setDe] = useState(from);
  const [ate, setAte] = useState(to);

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function choose(m: ReportPeriodMode) {
    if (m === "hoje") navigate({ periodo: null, de: null, ate: null });
    else if (m === "personalizado") navigate({ periodo: m, de: addDaysYmd(today, -6), ate: today });
    else navigate({ periodo: m, de: null, ate: null });
  }

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
        {OPTIONS.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={chipClass(mode === m)}
            onClick={() => choose(m)}
          >
            {label}
          </button>
        ))}
        {pending && (
          <Loader2
            className="text-muted-foreground size-5 animate-spin self-center"
            aria-label="Carregando"
          />
        )}
      </div>

      {mode === "personalizado" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Início</span>
            <Input
              type="date"
              aria-label="Início"
              value={de}
              onChange={(e) => {
                setDe(e.target.value);
                if (e.target.value && ate)
                  navigate({ periodo: "personalizado", de: e.target.value, ate });
              }}
              className="h-11 text-base"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Fim</span>
            <Input
              type="date"
              aria-label="Fim"
              value={ate}
              onChange={(e) => {
                setAte(e.target.value);
                if (e.target.value && de)
                  navigate({ periodo: "personalizado", de, ate: e.target.value });
              }}
              className="h-11 text-base"
            />
          </label>
        </div>
      )}
    </div>
  );
}
