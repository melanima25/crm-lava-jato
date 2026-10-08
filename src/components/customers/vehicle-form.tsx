"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bike, Car, Loader2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPlate, maskPlate, VEHICLE_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createVehicleAction, updateVehicleAction } from "@/server/customers/actions";
import type { VehicleDTO } from "@/server/customers/domain";
import { vehicleInputSchema, type VehicleInput } from "@/server/customers/schemas";

type Output = z.output<typeof vehicleInputSchema>;
type FieldName = "type" | "plate" | "brand" | "model" | "color" | "notes";
const FIELDS: FieldName[] = ["type", "plate", "brand", "model", "color", "notes"];

const TYPE_OPTIONS = [
  { value: "CAR", label: VEHICLE_TYPE_LABEL.CAR, icon: Car },
  { value: "MOTORCYCLE", label: VEHICLE_TYPE_LABEL.MOTORCYCLE, icon: Bike },
] as const;

export function VehicleForm({
  customerId,
  vehicle,
  onDone,
}: {
  customerId: number;
  vehicle?: VehicleDTO;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const editing = !!vehicle;

  const { control, handleSubmit, setError, setFocus } = useForm<VehicleInput, unknown, Output>({
    resolver: zodResolver(vehicleInputSchema),
    defaultValues: {
      type: vehicle?.type,
      plate: formatPlate(vehicle?.plate),
      brand: vehicle?.brand ?? "",
      model: vehicle?.model ?? "",
      color: vehicle?.color ?? "",
      notes: vehicle?.notes ?? "",
    },
  });

  function onSubmit(values: Output) {
    // Valores brutos: o servidor normaliza a placa e revalida.
    const raw: VehicleInput = {
      type: values.type,
      plate: values.plate,
      brand: values.brand,
      model: values.model,
      color: values.color,
      notes: values.notes,
    };
    startTransition(async () => {
      const r = editing
        ? await updateVehicleAction(vehicle.id, raw)
        : await createVehicleAction(customerId, raw);
      if (!r.ok) {
        const entries = Object.entries(r.fieldErrors ?? {}).filter(([k]) =>
          (FIELDS as string[]).includes(k),
        );
        for (const [key, message] of entries) {
          setError(key as FieldName, { type: "server", message });
        }
        const firstKey = entries[0]?.[0] as FieldName | undefined;
        if (firstKey && firstKey !== "type") setFocus(firstKey);
        toast.error(r.error);
        return;
      }
      toast.success(editing ? "Veículo atualizado" : "Veículo adicionado");
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Controller
          name="type"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <span id="vehicle-type-label" className="text-sm leading-none font-medium">
                Tipo de veículo
              </span>
              <div
                role="radiogroup"
                aria-labelledby="vehicle-type-label"
                aria-required="true"
                aria-describedby={fieldState.invalid ? "vehicle-type-error" : undefined}
                className="grid grid-cols-2 gap-2"
              >
                {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => {
                  const selected = field.value === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => field.onChange(value)}
                      onBlur={field.onBlur}
                      className={cn(
                        "focus-visible:ring-ring/50 flex h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted",
                        fieldState.invalid && !selected && "border-destructive",
                      )}
                    >
                      <Icon className="size-6" aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>
              <FieldError id="vehicle-type-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="plate"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="vehicle-plate">Placa (opcional)</Label>
              <Input
                {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(maskPlate(e.target.value))}
                id="vehicle-plate"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="ABC-1D23"
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "vehicle-plate-error" : undefined}
                className="h-11 font-mono tracking-wider uppercase"
              />
              <FieldError id="vehicle-plate-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="brand"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Label htmlFor="vehicle-brand">Marca</Label>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  id="vehicle-brand"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? "vehicle-brand-error" : undefined}
                  className="h-11"
                />
                <FieldError id="vehicle-brand-error" errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="model"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Label htmlFor="vehicle-model">Modelo</Label>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  id="vehicle-model"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? "vehicle-model-error" : undefined}
                  className="h-11"
                />
                <FieldError id="vehicle-model-error" errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>

        <Controller
          name="color"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="vehicle-color">Cor</Label>
              <Input
                {...field}
                value={field.value ?? ""}
                id="vehicle-color"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "vehicle-color-error" : undefined}
                className="h-11"
              />
              <FieldError id="vehicle-color-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="notes"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Label htmlFor="vehicle-notes">Observações</Label>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="vehicle-notes"
                rows={2}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "vehicle-notes-error" : undefined}
              />
              <FieldError id="vehicle-notes-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11" disabled={pending}>
            Cancelar
          </Button>
        </DialogClose>
        <Button type="submit" className="h-11 px-6" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando..." : editing ? "Salvar veículo" : "Adicionar veículo"}
        </Button>
      </div>
    </form>
  );
}
