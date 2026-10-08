"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone, maskPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createCustomerAction, updateCustomerAction } from "@/server/customers/actions";
import { customerInputSchema, type CustomerInput } from "@/server/customers/schemas";

type Output = z.output<typeof customerInputSchema>;
type FormValues = { name: string; phone: string; notes: string };

export function CustomerForm({
  customer,
}: {
  customer?: { id: number; name: string; phone: string | null; notes: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = !!customer;

  const { control, handleSubmit, setError, setFocus } = useForm<CustomerInput, unknown, Output>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: {
      name: customer?.name ?? "",
      phone: formatPhone(customer?.phone),
      notes: customer?.notes ?? "",
    } satisfies FormValues,
  });

  function onSubmit(values: Output) {
    // Envia os valores brutos do formulário; o servidor normaliza e revalida.
    const raw: CustomerInput = {
      name: values.name,
      phone: values.phone,
      notes: values.notes,
    };
    startTransition(async () => {
      const r = editing
        ? await updateCustomerAction(customer.id, raw)
        : await createCustomerAction(raw);
      if (!r.ok) {
        const entries = Object.entries(r.fieldErrors ?? {});
        for (const [key, message] of entries) {
          if (key === "name" || key === "phone" || key === "notes") {
            setError(key, { type: "server", message });
          }
        }
        const firstKey = entries
          .map(([k]) => k)
          .find((k) => ["name", "phone", "notes"].includes(k));
        if (firstKey) setFocus(firstKey as "name" | "phone" | "notes");
        toast.error(r.error);
        return;
      }
      toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado");
      router.push(`/clientes/${r.data.id}`);
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
              <Label htmlFor="customer-name">Nome</Label>
              <Input
                {...field}
                value={field.value ?? ""}
                id="customer-name"
                autoComplete="off"
                autoFocus
                required
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "customer-name-error" : undefined}
                className="h-11"
              />
              <FieldError id="customer-name-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="phone"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="customer-phone">Telefone (opcional)</Label>
              <Input
                {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskPhone(e.target.value))}
                id="customer-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(99) 99999-9999"
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "customer-phone-error" : undefined}
                className="h-11"
              />
              <FieldError id="customer-phone-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="notes"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="customer-notes">Observações (opcional)</Label>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="customer-notes"
                rows={3}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "customer-notes-error" : undefined}
              />
              <FieldError id="customer-notes-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href={editing ? `/clientes/${customer.id}` : "/clientes"}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 px-4")}
        >
          Cancelar
        </Link>
        <Button type="submit" className="h-11 px-6" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar cliente"}
        </Button>
      </div>
    </form>
  );
}
