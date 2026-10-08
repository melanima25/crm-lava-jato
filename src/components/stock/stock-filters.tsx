"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Filtro "Só estoque baixo" (?baixo=1); preserva q e inativos da URL. */
export function LowOnlyToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function onChange(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("baixo");
    if (next) params.set("baixo", "1");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <label className="flex min-h-10 w-fit cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary size-5"
      />
      Só estoque baixo
    </label>
  );
}
