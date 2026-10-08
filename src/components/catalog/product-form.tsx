"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { MoneyInput } from "@/components/money-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createProductAction, updateProductAction } from "@/server/catalog/actions";
import { productInputSchema, type ProductInput } from "@/server/catalog/schemas";

type Output = z.output<typeof productInputSchema>;
type FieldName = "name" | "description" | "unit" | "salePriceCents" | "minStockQuantity";
const FIELDS: FieldName[] = ["name", "description", "unit", "salePriceCents", "minStockQuantity"];

export function ProductForm({
  product,
}: {
  product?: {
    id: number;
    name: string;
    description: string | null;
    unit: string;
    salePriceCents: number | null;
    minStockQuantity?: number | null;
  };
}) {
  const router = useRouter();
  const [minText, setMinText] = useState(
    product?.minStockQuantity != null ? String(product.minStockQuantity) : "",
  );
  const [pending, startTransition] = useTransition();
  const editing = !!product;

  const { control, handleSubmit, setError, setFocus } = useForm<ProductInput, unknown, Output>({
    resolver: zodResolver(productInputSchema),
    defaultValues: {
      name: product?.name ?? "",
      description: product?.description ?? "",
      unit: product?.unit ?? "un",
      salePriceCents: product?.salePriceCents ?? null,
      minStockQuantity: product?.minStockQuantity ?? null,
    },
  });

  function onSubmit(values: Output) {
    startTransition(async () => {
      const r = editing
        ? await updateProductAction(product.id, values)
        : await createProductAction(values);
      if (!r.ok) {
        const entries = Object.entries(r.fieldErrors ?? {}).filter(([k]) =>
          FIELDS.includes(k as FieldName),
        ) as [FieldName, string][];
        for (const [key, message] of entries) setError(key, { type: "server", message });
        if (entries[0]) setFocus(entries[0][0]);
        toast.error(r.error);
        return;
      }
      toast.success(editing ? "Produto atualizado" : "Produto cadastrado");
      router.push("/produtos");
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="product-name">Nome</Label>
              <Input
                {...field}
                value={field.value ?? ""}
                id="product-name"
                autoComplete="off"
                autoFocus={!editing}
                required
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "product-name-error" : undefined}
                className="h-11"
              />
              <FieldError id="product-name-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="description"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="product-description">Descrição (opcional)</Label>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="product-description"
                rows={3}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "product-description-error" : undefined}
              />
              <FieldError id="product-description-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="unit"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Label htmlFor="product-unit">Unidade</Label>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  id="product-unit"
                  autoComplete="off"
                  placeholder="un"
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? "product-unit-error" : undefined}
                  className="h-11"
                />
                <FieldDescription>Ex.: un, L, kg, ml.</FieldDescription>
                <FieldError id="product-unit-error" errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="salePriceCents"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Label htmlFor="product-price">Preço de venda (opcional)</Label>
                <MoneyInput
                  ref={field.ref}
                  id="product-price"
                  name={field.name}
                  onBlur={field.onBlur}
                  value={(field.value as number | null | undefined) ?? null}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  className="h-11"
                />
                <FieldDescription>Deixe vazio se for só de uso interno.</FieldDescription>
              </Field>
            )}
          />
        </div>
        <Controller
          name="minStockQuantity"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="product-min-stock">Estoque mínimo (opcional)</Label>
              <Input
                ref={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                id="product-min-stock"
                inputMode="numeric"
                autoComplete="off"
                value={minText}
                onChange={(e) => {
                  const t = e.target.value;
                  setMinText(t);
                  const trimmed = t.trim();
                  field.onChange(
                    trimmed === "" ? null : /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN,
                  );
                }}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "product-min-stock-error" : undefined}
                className="h-11 sm:max-w-40"
              />
              <FieldDescription>Avisa quando o estoque chegar a esse número.</FieldDescription>
              <FieldError id="product-min-stock-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/produtos" className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}>
          Cancelar
        </Link>
        <Button type="submit" className="h-11 px-6" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar produto"}
        </Button>
      </div>
    </form>
  );
}
