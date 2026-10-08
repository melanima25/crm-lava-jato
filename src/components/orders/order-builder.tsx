"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bike, Car, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import {
  PaymentDialog,
  type PaymentLine,
  type PaymentSubmitResult,
} from "@/components/orders/payment-dialog";
import { ProductTiles, type ProductOption } from "@/components/orders/product-tiles";
import { ServiceTiles, type ServiceOption } from "@/components/orders/service-tiles";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { maskPhone, maskPlate, VEHICLE_TYPE_LABEL } from "@/lib/format";
import { formatBRL } from "@/lib/money";
import { vehicleLabel } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { createCustomerAction, createVehicleAction } from "@/server/customers/actions";
import { completeOrderAction, createOrderAction } from "@/server/orders/actions";

type VehicleType = "CAR" | "MOTORCYCLE";

export type BuilderVehicle = {
  id: number;
  type: VehicleType;
  plate: string | null;
  brand: string | null;
  model: string | null;
};

export type BuilderCustomer = {
  id: number;
  name: string;
  phone: string | null;
  /** Saldo devedor atual (só aviso; não bloqueia o atendimento). */
  debtCents: number;
  vehicles: BuilderVehicle[];
};

type Item = { serviceId: number; name: string; quantity: number; priceCents: number | null };
type ProductItem = {
  productId: number;
  name: string;
  unit: string;
  stockQuantity: number;
  quantity: number;
  priceCents: number | null;
};

const TYPE_OPTIONS = [
  { value: "CAR", label: VEHICLE_TYPE_LABEL.CAR, icon: Car },
  { value: "MOTORCYCLE", label: VEHICLE_TYPE_LABEL.MOTORCYCLE, icon: Bike },
] as const;

const validCents = (c: number | null): c is number => c != null && !Number.isNaN(c) && c >= 0;

/**
 * Monta o atendimento: cliente existente (com veículos) ou cadastro rápido; serviços e produtos por
 * toque; desconto/observação opcionais; barra fixa com o total. Veículo só é exigido com serviço
 * (venda só de produtos dispensa, E9). Os valores do total aqui são só pré-visualização — o
 * servidor recalcula e é quem vale.
 */
export function OrderBuilder({
  customer,
  services,
  products,
  preferPlate,
}: {
  customer: BuilderCustomer | null;
  services: Record<VehicleType, ServiceOption[]>;
  products: ProductOption[];
  preferPlate?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Cadastro rápido de cliente
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // Veículo
  const vehicles = customer?.vehicles ?? [];
  const [vehicleId, setVehicleId] = useState<number | null>(() => {
    const byPlate = preferPlate ? vehicles.find((v) => v.plate === preferPlate) : undefined;
    if (byPlate) return byPlate.id;
    return vehicles.length === 1 ? vehicles[0].id : null;
  });
  const [newVehicle, setNewVehicle] = useState(vehicles.length === 0);
  const [nvType, setNvType] = useState<VehicleType | null>(null);
  const [nvPlate, setNvPlate] = useState("");
  const [nvModel, setNvModel] = useState("");

  // Serviços e extras
  const [items, setItems] = useState<Item[]>([]);
  const [productItems, setProductItems] = useState<ProductItem[]>([]);
  const [discount, setDiscount] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [showExtras, setShowExtras] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const created = useRef<{ customerId?: number; vehicleId?: number }>({});
  const [paying, setPaying] = useState<{ id: number; totalCents: number } | null>(null);

  const vehicleType: VehicleType | null = newVehicle
    ? nvType
    : (vehicles.find((v) => v.id === vehicleId)?.type ?? null);

  // ---- pré-visualização (centavos inteiros) ----
  const lines = [...items, ...productItems];
  const priceOk = lines.every((i) => validCents(i.priceCents));
  const subtotal = lines.reduce(
    (s, i) => s + i.quantity * (validCents(i.priceCents) ? i.priceCents : 0),
    0,
  );
  const discountOk = discount === null || (validCents(discount) && discount <= subtotal);
  const discountCents = discount !== null && validCents(discount) ? discount : 0;
  const total = Math.max(0, subtotal - discountCents);

  const customerOk = customer ? true : name.trim().length >= 2;
  // Veículo só é obrigatório com serviço (venda só de produtos dispensa).
  const vehicleRequired = items.length > 0;
  const vehicleOk = !vehicleRequired || (newVehicle ? nvType !== null : vehicleId !== null);
  const canSubmit = customerOk && vehicleOk && lines.length > 0 && priceOk && discountOk && !paying;

  function changeType(next: VehicleType | null) {
    if (next !== vehicleType) setItems([]); // os serviços dependem do tipo do veículo
  }

  function pickVehicle(id: number) {
    changeType(vehicles.find((v) => v.id === id)?.type ?? null);
    setNewVehicle(false);
    setVehicleId(id);
    setErrors({});
  }

  function pickNewVehicle() {
    changeType(nvType);
    setNewVehicle(true);
    setErrors({});
  }

  function pickNvType(t: VehicleType) {
    changeType(t);
    setNvType(t);
  }

  function addService(s: ServiceOption) {
    setItems((list) => {
      const found = list.find((i) => i.serviceId === s.id);
      if (found) {
        return list.map((i) =>
          i.serviceId === s.id ? { ...i, quantity: Math.min(999, i.quantity + 1) } : i,
        );
      }
      return [
        ...list,
        { serviceId: s.id, name: s.name, quantity: 1, priceCents: s.suggestedPriceCents },
      ];
    });
  }

  function patchItem(serviceId: number, change: Partial<Item>) {
    setItems((list) => list.map((i) => (i.serviceId === serviceId ? { ...i, ...change } : i)));
  }

  function addProduct(p: ProductOption) {
    setProductItems((list) => {
      if (list.some((i) => i.productId === p.id)) {
        return list.map((i) =>
          i.productId === p.id ? { ...i, quantity: Math.min(999, i.quantity + 1) } : i,
        );
      }
      return [
        ...list,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          stockQuantity: p.stockQuantity,
          quantity: 1,
          priceCents: p.salePriceCents,
        },
      ];
    });
  }

  function patchProduct(productId: number, change: Partial<ProductItem>) {
    setProductItems((list) =>
      list.map((i) => (i.productId === productId ? { ...i, ...change } : i)),
    );
  }

  /** Cria cliente (se rápido), veículo (se novo) e a OS. Reaproveita o que já foi criado em tentativas anteriores. */
  async function persist(): Promise<{ id: number; totalCents: number } | null> {
    setErrors({});
    let customerId = customer?.id ?? created.current.customerId;
    if (!customerId) {
      const r = await createCustomerAction({ name, phone });
      if (!r.ok) {
        const fe = r.fieldErrors ?? {};
        setErrors({ name: fe.name ?? "", phone: fe.phone ?? "" });
        toast.error(r.error);
        return null;
      }
      customerId = r.data.id;
      created.current.customerId = customerId;
    }

    let vId = newVehicle ? created.current.vehicleId : (vehicleId ?? undefined);
    // Sem tipo escolhido (só possível em venda só de produtos) o veículo novo não é criado.
    if (newVehicle && !vId && nvType !== null) {
      const r = await createVehicleAction(customerId, {
        type: nvType,
        plate: nvPlate,
        model: nvModel,
      });
      if (!r.ok) {
        const fe = r.fieldErrors ?? {};
        setErrors({ nvPlate: fe.plate ?? "", nvModel: fe.model ?? "" });
        toast.error(r.error);
        return null;
      }
      vId = r.data.id;
      created.current.vehicleId = vId;
    }

    const r = await createOrderAction({
      customerId,
      vehicleId: vId,
      discountCents,
      notes,
      items: items.map((i) => ({
        serviceId: i.serviceId,
        quantity: i.quantity,
        unitPriceCents: i.priceCents ?? undefined,
      })),
      products: productItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPriceCents: i.priceCents ?? undefined,
      })),
    });
    if (!r.ok) {
      const fe = r.fieldErrors ?? {};
      const next: Record<string, string> = {};
      if (fe.discountCents) next.discount = fe.discountCents;
      if (fe.notes) next.notes = fe.notes;
      items.forEach((it, idx) => {
        const m = fe[`items.${idx}.unitPriceCents`] ?? fe[`items.${idx}.quantity`];
        if (m) next[`item-${it.serviceId}`] = m;
      });
      productItems.forEach((it, idx) => {
        const m =
          fe[`products.${idx}.unitPriceCents`] ??
          fe[`products.${idx}.quantity`] ??
          fe[`products.${idx}.productId`];
        if (m) next[`product-${it.productId}`] = m;
      });
      setErrors(next);
      if (next.discount || next.notes) setShowExtras(true);
      toast.error(r.error);
      return null;
    }
    return { id: r.data.id, totalCents: r.data.totalCents };
  }

  function submit(andComplete: boolean) {
    if (!canSubmit) return;
    startTransition(async () => {
      const order = await persist();
      if (!order) return;
      if (andComplete) {
        setPaying(order);
      } else {
        toast.success("Atendimento criado");
        router.push(`/atendimentos/${order.id}`);
      }
    });
  }

  async function complete(payments: PaymentLine[]): Promise<PaymentSubmitResult> {
    if (!paying) return { ok: false, error: "Atendimento não encontrado" };
    const r = await completeOrderAction(paying.id, payments);
    if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
    toast.success(
      payments.length === 0 ? "Atendimento concluído no fiado" : "Atendimento concluído",
    );
    router.push(`/atendimentos/${paying.id}`);
    return { ok: true };
  }

  const counts = Object.fromEntries(items.map((i) => [i.serviceId, i.quantity]));
  const productCounts = Object.fromEntries(productItems.map((i) => [i.productId, i.quantity]));

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Cliente */}
      <section aria-labelledby="sec-cliente" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="sec-cliente" className="text-lg font-semibold">
            {customer ? "Cliente" : "Cadastro rápido"}
          </h2>
          <Link
            href="/atendimentos/novo"
            className="text-primary inline-flex min-h-11 items-center text-sm font-medium hover:underline"
          >
            {customer ? "Trocar cliente" : "Buscar cliente existente"}
          </Link>
        </div>
        {customer ? (
          <div className="flex flex-col gap-2">
            <div className="bg-card rounded-xl border p-3">
              <p className="font-medium [overflow-wrap:anywhere]">{customer.name}</p>
            </div>
            {customer.debtCents > 0 && (
              <div
                role="status"
                data-testid="customer-debt-banner"
                className="border-destructive/50 bg-destructive/10 flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-destructive flex items-center gap-2 font-semibold">
                  <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
                  <span>
                    Cliente deve <Money cents={customer.debtCents} />
                  </span>
                </p>
                <div className="flex gap-2">
                  <Link
                    href={`/fiado?receber=${customer.id}`}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-11 flex-1 sm:flex-none",
                    )}
                  >
                    Receber
                  </Link>
                  <Link
                    href={`/clientes/${customer.id}`}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-11 flex-1 sm:flex-none",
                    )}
                  >
                    Ver fiado
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quick-name">Nome</Label>
              <Input
                id="quick-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                autoFocus
                aria-invalid={errors.name ? true : undefined}
                className="h-11 text-base"
              />
              {errors.name && <p className="text-destructive text-sm">{errors.name}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quick-phone">Telefone (opcional)</Label>
              <Input
                id="quick-phone"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                inputMode="tel"
                autoComplete="off"
                placeholder="(11) 98765-4321"
                aria-invalid={errors.phone ? true : undefined}
                className="h-11 text-base"
              />
              {errors.phone && <p className="text-destructive text-sm">{errors.phone}</p>}
            </div>
          </div>
        )}
      </section>

      {/* 2. Veículo */}
      <section aria-labelledby="sec-veiculo" className="flex flex-col gap-3">
        <h2 id="sec-veiculo" className="text-lg font-semibold">
          Veículo
        </h2>
        {products.length > 0 && !vehicleRequired && (
          <p className="text-muted-foreground -mt-2 text-sm">
            Opcional se for só venda de produtos.
          </p>
        )}
        {vehicles.length > 0 && (
          <div role="radiogroup" aria-labelledby="sec-veiculo" className="flex flex-col gap-2">
            {vehicles.map((v) => {
              const selected = !newVehicle && vehicleId === v.id;
              const Icon = v.type === "CAR" ? Car : Bike;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => pickVehicle(v.id)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex min-h-14 items-center gap-3 rounded-xl border-2 px-3 text-left outline-none focus-visible:ring-3",
                    selected ? "border-primary bg-primary/5" : "bg-background hover:bg-muted",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{vehicleLabel(v)}</span>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={newVehicle}
              onClick={pickNewVehicle}
              className={cn(
                "focus-visible:ring-ring/50 flex min-h-12 items-center gap-2 rounded-xl border-2 border-dashed px-3 text-sm font-medium outline-none focus-visible:ring-3",
                newVehicle ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <Plus className="size-4" aria-hidden="true" />
              Outro veículo
            </button>
          </div>
        )}
        {newVehicle && (
          <div className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Tipo de veículo" className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => {
                const selected = nvType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => pickNvType(value)}
                    className={cn(
                      "focus-visible:ring-ring/50 flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold outline-none focus-visible:ring-3",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nv-plate">Placa (opcional)</Label>
                <Input
                  id="nv-plate"
                  value={nvPlate}
                  onChange={(e) => setNvPlate(maskPlate(e.target.value))}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABC-1D23"
                  aria-invalid={errors.nvPlate ? true : undefined}
                  className="h-11 font-mono tracking-wider uppercase"
                />
                {errors.nvPlate && <p className="text-destructive text-sm">{errors.nvPlate}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nv-model">Modelo (opcional)</Label>
                <Input
                  id="nv-model"
                  value={nvModel}
                  onChange={(e) => setNvModel(e.target.value)}
                  autoComplete="off"
                  aria-invalid={errors.nvModel ? true : undefined}
                  className="h-11 text-base"
                />
                {errors.nvModel && <p className="text-destructive text-sm">{errors.nvModel}</p>}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3. Serviços */}
      <section aria-labelledby="sec-servicos" className="flex flex-col gap-3">
        <h2 id="sec-servicos" className="text-lg font-semibold">
          Serviços
        </h2>
        {vehicleType === null ? (
          <p className="text-muted-foreground text-sm">
            Escolha o veículo para ver os serviços oferecidos.
          </p>
        ) : services[vehicleType].length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum serviço oferecido para {VEHICLE_TYPE_LABEL[vehicleType].toLowerCase()}. Cadastre
            em{" "}
            <Link href="/servicos" className="underline">
              Serviços
            </Link>
            .
          </p>
        ) : (
          <ServiceTiles
            services={services[vehicleType]}
            counts={counts}
            onPick={addService}
            disabled={pending}
          />
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Serviços do atendimento">
            {items.map((i) => (
              <li key={i.serviceId} className="bg-card flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{i.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="-my-1 -mr-1 size-11"
                    onClick={() => setItems((l) => l.filter((x) => x.serviceId !== i.serviceId))}
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="sr-only">Remover {i.name}</span>
                  </Button>
                </div>
                <div className="flex items-start gap-3">
                  <div
                    className="flex items-center gap-1"
                    role="group"
                    aria-label={`Quantidade de ${i.name}`}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      className="size-11"
                      disabled={i.quantity <= 1}
                      onClick={() => patchItem(i.serviceId, { quantity: i.quantity - 1 })}
                    >
                      <Minus aria-hidden="true" />
                      <span className="sr-only">Diminuir quantidade</span>
                    </Button>
                    <span
                      className="w-8 text-center text-lg font-semibold tabular-nums"
                      aria-live="polite"
                    >
                      {i.quantity}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="size-11"
                      disabled={i.quantity >= 999}
                      onClick={() => patchItem(i.serviceId, { quantity: i.quantity + 1 })}
                    >
                      <Plus aria-hidden="true" />
                      <span className="sr-only">Aumentar quantidade</span>
                    </Button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <MoneyInput
                      aria-label={`Preço unitário de ${i.name}`}
                      value={i.priceCents}
                      onChange={(c) => patchItem(i.serviceId, { priceCents: c })}
                      error={
                        errors[`item-${i.serviceId}`] ??
                        (i.priceCents === null ? "Informe o preço" : undefined)
                      }
                      className="h-11 text-base"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3b. Produtos (E9): só informa o estoque; a baixa acontece ao concluir */}
      {products.length > 0 && (
        <section aria-labelledby="sec-produtos" className="flex flex-col gap-3">
          <h2 id="sec-produtos" className="text-lg font-semibold">
            Produtos
          </h2>
          <ProductTiles
            products={products}
            counts={productCounts}
            onPick={addProduct}
            disabled={pending}
          />
          {productItems.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Produtos do atendimento">
              {productItems.map((i) => (
                <li key={i.productId} className="bg-card flex flex-col gap-2 rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium [overflow-wrap:anywhere]">{i.name}</p>
                      <p
                        className={cn(
                          "text-sm",
                          i.quantity > i.stockQuantity
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        Estoque: {i.stockQuantity} {i.unit}
                        {i.quantity > i.stockQuantity ? " — insuficiente para concluir" : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="-my-1 -mr-1 size-11"
                      onClick={() =>
                        setProductItems((l) => l.filter((x) => x.productId !== i.productId))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      <span className="sr-only">Remover {i.name}</span>
                    </Button>
                  </div>
                  <div className="flex items-start gap-3">
                    <div
                      className="flex items-center gap-1"
                      role="group"
                      aria-label={`Quantidade de ${i.name}`}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11"
                        disabled={i.quantity <= 1}
                        onClick={() => patchProduct(i.productId, { quantity: i.quantity - 1 })}
                      >
                        <Minus aria-hidden="true" />
                        <span className="sr-only">Diminuir quantidade</span>
                      </Button>
                      <span
                        className="w-8 text-center text-lg font-semibold tabular-nums"
                        aria-live="polite"
                      >
                        {i.quantity}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11"
                        disabled={i.quantity >= 999}
                        onClick={() => patchProduct(i.productId, { quantity: i.quantity + 1 })}
                      >
                        <Plus aria-hidden="true" />
                        <span className="sr-only">Aumentar quantidade</span>
                      </Button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <MoneyInput
                        aria-label={`Preço unitário de ${i.name}`}
                        value={i.priceCents}
                        onChange={(c) => patchProduct(i.productId, { priceCents: c })}
                        error={
                          errors[`product-${i.productId}`] ??
                          (i.priceCents === null ? "Informe o preço" : undefined)
                        }
                        className="h-11 text-base"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 4. Desconto e observação */}
      <section aria-label="Extras do atendimento" className="flex flex-col gap-3">
        {!showExtras ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit"
            onClick={() => setShowExtras(true)}
          >
            <Plus aria-hidden="true" />
            Desconto e observação
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-discount">Desconto</Label>
              <MoneyInput
                id="order-discount"
                value={discount}
                onChange={setDiscount}
                error={
                  errors.discount ??
                  (discount !== null && validCents(discount) && discount > subtotal
                    ? "O desconto não pode ser maior que o subtotal"
                    : undefined)
                }
                className="h-11 text-base"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-notes">Observação</Label>
              <Textarea
                id="order-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={1000}
                aria-invalid={errors.notes ? true : undefined}
              />
              {errors.notes && <p className="text-destructive text-sm">{errors.notes}</p>}
            </div>
          </div>
        )}
      </section>

      {/* Barra fixa: total + ações (acima da barra de navegação no celular) */}
      <div
        className={cn(
          "bg-background sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-col gap-2 border-t px-4 py-3",
          "md:bottom-0 md:mx-0 md:rounded-xl md:border",
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground text-sm">
            {lines.length === 0
              ? products.length > 0
                ? "Toque em um serviço ou produto"
                : "Toque em um serviço"
              : discountCents > 0
                ? `Subtotal ${formatBRL(subtotal)} − desconto`
                : "Total"}
          </span>
          <span className="text-2xl font-semibold" data-testid="order-total" aria-live="polite">
            <Money cents={total} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base"
            disabled={!canSubmit || pending}
            onClick={() => submit(false)}
          >
            Criar atendimento
          </Button>
          <Button
            type="button"
            className="h-12 text-base"
            disabled={!canSubmit || pending}
            onClick={() => submit(true)}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Criar e concluir
          </Button>
        </div>
      </div>

      <PaymentDialog
        open={paying !== null}
        onOpenChange={(o) => {
          if (!o && paying) {
            toast.info("Atendimento criado e em andamento. Conclua quando quiser.");
            router.push(`/atendimentos/${paying.id}`);
          }
        }}
        totalCents={paying?.totalCents ?? 0}
        allowFiado
        title="Concluir e receber"
        confirmLabel="Concluir e receber"
        onSubmit={complete}
      />
    </div>
  );
}
