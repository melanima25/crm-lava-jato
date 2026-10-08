import { cn } from "@/lib/utils";

// Marca provisória em texto (inspirada na logo). Quando o arquivo da logo chegar,
// troque o corpo deste componente por <Image src="/brand/logo.svg" alt="TZ Auto Estética" ... />
// mantendo a prop `size` (a altura/largura é derivada dela).
type BrandMarkProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES = {
  sm: {
    main: "text-base tracking-[0.28em]",
    sub: "text-[0.5rem] tracking-[0.5em]",
    gap: "gap-0.5",
  },
  md: { main: "text-xl tracking-[0.3em]", sub: "text-[0.6rem] tracking-[0.55em]", gap: "gap-1" },
  lg: { main: "text-4xl tracking-[0.3em]", sub: "text-xs tracking-[0.6em]", gap: "gap-1.5" },
} as const;

export function BrandMark({ size = "md", className }: BrandMarkProps) {
  const s = SIZES[size];
  return (
    <span
      role="img"
      aria-label="TZ Auto Estética"
      className={cn("inline-flex flex-col items-center leading-none select-none", s.gap, className)}
    >
      <span aria-hidden="true" className={cn("text-silver pl-[0.3em] font-semibold", s.main)}>
        TZ AUTO
      </span>
      <span
        aria-hidden="true"
        className="h-px w-full bg-linear-to-r from-transparent via-[#8e929a] to-transparent"
      />
      <span
        aria-hidden="true"
        className={cn("text-muted-foreground pl-[0.55em] font-medium", s.sub)}
      >
        ESTÉTICA
      </span>
    </span>
  );
}
