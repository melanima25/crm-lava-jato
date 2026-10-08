"use client";

import { useTransition } from "react";
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
import { createServiceAction, updateServiceAction } from "@/server/catalog/actions";
import { serviceInputSchema, type ServiceInput } from "@/server/catalog/schemas";

type Output = z.output<typeof serviceInputSchema>;
type FieldName = "name" | "description" | "carPriceCents" | "motorcyclePriceCents";
const FIELDS: FieldName[] = ["name", "description", "carPriceCents", "motorcyclePriceCents"];

export function ServiceForm({
  service,
}: {
  service?: {
    id: number;
    name: string;
    description: string | null;
    carPriceCents: number | null;
    motorcyclePriceCents: number | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = !!service;

  const { control, handleSubmit, setError, setFocus } = useForm<ServiceInput, unknown, Output>({
    resolver: zodResolver(serviceInputSchema),
    defaultValues: {
      name: service?.name ?? "",
      description: service?.description ?? "",
      carPriceCents: service?.carPriceCents ?? null,
      motorcyclePriceCents: service?.motorcyclePriceCents ?? null,
    },
  });

  function onSubmit(values: Output) {
    startTransition(async () => {
      const r = editing
        ? await updateServiceAction(service.id, values)
        : await createServiceAction(values);
      if (!r.ok) {
        const entries = Object.entries(r.fieldErrors ?? {}).filter(([k]) =>
          FIELDS.includes(k as FieldName),
        ) as [FieldName, string][];
        for (const [key, message] of entries) setError(key, { type: "server", message });
        if (entries[0]) setFocus(entries[0][0]);
        toast.error(r.error);
        return;
      }
      toast.success(editing ? "Serviço atualizado" : "Serviço cadastrado");
      router.push("/servicos");
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
              <Label htmlFor="service-name">Nome</Label>
              <Input
                {...field}
                value={field.value ?? ""}
                id="service-name"
                autoComplete="off"
                autoFocus={!editing}
                required
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "service-name-error" : undefined}
                className="h-11"
              />
              <FieldError id="service-name-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="description"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="service-description">Descrição (opcional)</Label>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="service-description"
                rows={3}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "service-description-error" : undefined}
              />
              <FieldError id="service-description-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="carPriceCents"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Label htmlFor="service-car-price">Preço Carro (opcional)</Label>
                <MoneyInput
                  ref={field.ref}
                  id="service-car-price"
                  name={field.name}
                  onBlur={field.onBlur}
                  value={(field.value as number | null | undefined) ?? null}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  className="h-11"
                />
              </Field>
            )}
          />
          <Controller
            name="motorcyclePriceCents"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Label htmlFor="service-moto-price">Preço Moto (opcional)</Label>
                <MoneyInput
                  ref={field.ref}
                  id="service-moto-price"
                  name={field.name}
                  onBlur={field.onBlur}
                  value={(field.value as number | null | undefined) ?? null}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  className="h-11"
                />
              </Field>
            )}
          />
        </div>
        <FieldDescription>
          Deixe vazio se não oferece para esse tipo. Informe ao menos um dos preços.
        </FieldDescription>
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href="/servicos" className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}>
          Cancelar
        </Link>
        <Button type="submit" className="h-11 px-6" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar serviço"}
        </Button>
      </div>
    </form>
  );
}
