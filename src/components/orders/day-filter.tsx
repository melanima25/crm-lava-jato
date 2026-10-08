"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_FILTER_OPTIONS } from "@/lib/order-ui";
import { cn } from "@/lib/utils";

/** Filtro de dia (e status, opcional) via query string: ?data=yyyy-mm-dd&status=OPEN. */
export function DayFilter({
  date,
  today,
  prev,
  next,
  status,
  withStatus = false,
}: {
  date: string;
  today: string;
  prev: string;
  next: string;
  status?: string;
  withStatus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function href(d: string, s: string | undefined) {
    const params = new URLSearchParams();
    if (d !== today) params.set("data", d);
    if (s) params.set("status", s);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function go(d: string, s: string | undefined) {
    startTransition(() => router.replace(href(d, s), { scroll: false }));
  }

  const iconBtn = cn(buttonVariants({ variant: "outline" }), "size-11 shrink-0");

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div className="flex items-center gap-2">
        <Link href={href(prev, status)} className={iconBtn} aria-label="Dia anterior">
          <ChevronLeft aria-hidden="true" />
        </Link>
        <Input
          type="date"
          aria-label="Data"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value, status)}
          className="h-11 min-w-0 flex-1 text-base"
        />
        <Link href={href(next, status)} className={iconBtn} aria-label="Próximo dia">
          <ChevronRight aria-hidden="true" />
        </Link>
        {date !== today && (
          <Link
            href={href(today, status)}
            className={cn(buttonVariants({ variant: "secondary" }), "h-11 px-3")}
          >
            Hoje
          </Link>
        )}
      </div>
      {withStatus && (
        <div role="group" aria-label="Filtrar por status" className="flex flex-wrap gap-2">
          {STATUS_FILTER_OPTIONS.map((o) => {
            const active = (status ?? "") === o.value;
            return (
              <button
                key={o.value || "todos"}
                type="button"
                aria-pressed={active}
                onClick={() => go(date, o.value || undefined)}
                className={cn(
                  "focus-visible:ring-ring/50 min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
