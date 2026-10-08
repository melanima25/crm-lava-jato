"use client";

import { useState } from "react";
import { Bike, Car, Pencil, Plus, Power, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { InactiveBadge } from "@/components/inactive-badge";
import { VehicleForm } from "@/components/customers/vehicle-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPlate, VEHICLE_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setVehicleActiveAction } from "@/server/customers/actions";
import type { VehicleDTO } from "@/server/customers/domain";

type FormState = { mode: "new" } | { mode: "edit"; vehicle: VehicleDTO } | null;

function describe(v: VehicleDTO) {
  return [v.brand, v.model, v.color].filter(Boolean).join(" · ");
}

export function VehicleList({
  customerId,
  customerActive,
  vehicles,
}: {
  customerId: number;
  customerActive: boolean;
  vehicles: VehicleDTO[];
}) {
  const [form, setForm] = useState<FormState>(null);
  const [toggling, setToggling] = useState<VehicleDTO | null>(null);

  async function onToggle() {
    if (!toggling) return false;
    const r = await setVehicleActiveAction(toggling.id, !toggling.active);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(toggling.active ? "Veículo inativado" : "Veículo reativado");
    return true;
  }

  const label = (v: VehicleDTO) =>
    formatPlate(v.plate) || describe(v) || VEHICLE_TYPE_LABEL[v.type];

  return (
    <section aria-labelledby="vehicles-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="vehicles-heading" className="text-lg font-semibold">
          Veículos
        </h2>
        {customerActive && (
          <Button type="button" className="h-11 px-4" onClick={() => setForm({ mode: "new" })}>
            <Plus aria-hidden="true" />
            Adicionar veículo
          </Button>
        )}
      </div>

      {vehicles.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
          <Car className="size-9" aria-hidden="true" />
          <p className="text-foreground font-medium">Nenhum veículo cadastrado</p>
          {customerActive && <p className="text-sm">Adicione o carro ou a moto deste cliente.</p>}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Veículos do cliente">
          {vehicles.map((v) => {
            const Icon = v.type === "CAR" ? Car : Bike;
            return (
              <li
                key={v.id}
                data-testid="vehicle-item"
                data-active={v.active}
                className={cn(
                  "bg-card flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center",
                  !v.active && "bg-muted/40",
                )}
              >
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3",
                    !v.active && "opacity-60",
                  )}
                >
                  <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold tracking-wider">
                        {formatPlate(v.plate) || "Sem placa"}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {VEHICLE_TYPE_LABEL[v.type]}
                      </span>
                      {!v.active && <InactiveBadge />}
                    </div>
                    {describe(v) && (
                      <p className="text-muted-foreground truncate text-sm">{describe(v)}</p>
                    )}
                    {v.notes && <p className="text-muted-foreground truncate text-xs">{v.notes}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 flex-1 sm:flex-none"
                    onClick={() => setForm({ mode: "edit", vehicle: v })}
                  >
                    <Pencil aria-hidden="true" />
                    Editar
                    <span className="sr-only"> veículo {label(v)}</span>
                  </Button>
                  {(v.active || customerActive) && (
                    <Button
                      type="button"
                      variant={v.active ? "outline" : "secondary"}
                      className="h-11 flex-1 sm:flex-none"
                      onClick={() => setToggling(v)}
                    >
                      {v.active ? <Power aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                      {v.active ? "Inativar" : "Reativar"}
                      <span className="sr-only"> veículo {label(v)}</span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          {form && (
            <>
              <DialogHeader>
                <DialogTitle>{form.mode === "new" ? "Novo veículo" : "Editar veículo"}</DialogTitle>
                <DialogDescription>
                  Escolha se é carro ou moto; os demais dados são opcionais.
                </DialogDescription>
              </DialogHeader>
              <VehicleForm
                customerId={customerId}
                vehicle={form.mode === "edit" ? form.vehicle : undefined}
                onDone={() => setForm(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.active ? "Inativar veículo?" : "Reativar veículo?"}
        description={
          toggling?.active
            ? `O veículo ${toggling ? label(toggling) : ""} deixará de ser oferecido em novos atendimentos. Você pode reativar depois.`
            : `O veículo ${toggling ? label(toggling) : ""} voltará a ser oferecido em novos atendimentos.`
        }
        confirmLabel={toggling?.active ? "Inativar" : "Reativar"}
        pendingLabel={toggling?.active ? "Inativando..." : "Reativando..."}
        destructive={!!toggling?.active}
        onConfirm={onToggle}
      />
    </section>
  );
}
