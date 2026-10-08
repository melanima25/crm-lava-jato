"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Minus, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Money } from "@/components/money";
import { MoneyInput } from "@/components/money-input";
import {
  AdjustStockLink,
  adjustStockHref,
  ProductTiles,
  stockProductIdOf,
  type ProductOption,
} from "@/components/orders/product-tiles";
import { ServiceTiles, type ServiceOption } from "@/components/orders/service-tiles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addProductItemAction,
  addServiceItemAction,
  removeOrderItemAction,
  updateOrderItemAction,
} from "@/server/orders/actions";

export type ItemView = {
  id: number;
  serviceId: number | null;
  productId: number | null;
  kind: "SERVICE" | "PRODUCT";
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  /** Só produto: unidade e estoque atual. */
  unit: string | null;
  stockQuantity: number | null;
};

type Status = "OPEN" | "DONE" | "CANCELED";

const KIND_LABEL = { SERVICE: "serviço", PRODUCT: "produto" } as const;

/**
 * Itens do atendimento (serviços e produtos); edição enquanto a OS não está cancelada (D-38).
 * Produto (E9): em OS em andamento o estoque é só informativo; em OS concluída adicionar, alterar e
 * remover já mexem no estoque.
 */
export function OrderItems({
  orderId,
  status,
  items,
  services,
  products,
}: {
  orderId: number;
  status: Status;
  items: ItemView[];
  /** Serviços oferecidos ao tipo do veículo (vazio se não houver veículo). */
  services: ServiceOption[];
  /** Produtos à venda (ativos e com preço de venda). */
  products: ProductOption[];
}) {
  const router = useRouter();
  const editable = status !== "CANCELED";
  const [editing, setEditing] = useState<ItemView | null>(null);
  const [removing, setRemoving] = useState<ItemView | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"SERVICE" | "PRODUCT" | null>(null);
  const [addPending, startAdd] = useTransition();

  const serviceCounts: Record<number, number> = {};
  const productCounts: Record<number, number> = {};
  for (const i of items) {
    if (i.serviceId) serviceCounts[i.serviceId] = i.quantity;
    if (i.productId) productCounts[i.productId] = (productCounts[i.productId] ?? 0) + i.quantity;
  }

  function addService(s: ServiceOption) {
    startAdd(async () => {
      const r = await addServiceItemAction(orderId, { serviceId: s.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${s.name} adicionado`);
      setAdding(null);
      router.refresh();
    });
  }

  function addProduct(p: ProductOption) {
    startAdd(async () => {
      const r = await addProductItemAction(orderId, { productId: p.id });
      if (!r.ok) {
        const stockId = stockProductIdOf(r.fieldErrors);
        toast.error(r.error, {
          action: stockId
            ? { label: "Acertar inventário", onClick: () => router.push(adjustStockHref(stockId)) }
            : undefined,
        });
        return;
      }
      toast.success(`${p.name} adicionado`);
      setAdding(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="sec-itens" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sec-itens" className="text-lg font-semibold">
          Itens
        </h2>
        {editable && (services.length > 0 || products.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {services.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setAdding("SERVICE")}
              >
                <Plus aria-hidden="true" />
                Adicionar serviço
              </Button>
            )}
            {products.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setAdding("PRODUCT")}
              >
                <Package aria-hidden="true" />
                Adicionar produto
              </Button>
            )}
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-2" aria-label="Itens do atendimento">
        {items.map((i) => {
          const short =
            status === "OPEN" &&
            i.kind === "PRODUCT" &&
            i.productId !== null &&
            (i.stockQuantity ?? 0) < (productCounts[i.productId] ?? i.quantity);
          return (
            <li key={i.id} className="bg-card flex flex-col gap-1 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
                    {i.description}
                    {i.kind === "PRODUCT" && (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                        Produto
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {i.quantity}
                    {i.unit ? ` ${i.unit}` : ""} × <Money cents={i.unitPriceCents} />
                  </p>
                </div>
                <Money cents={i.totalCents} className="font-semibold" />
                {editable && (
                  <div className="flex">
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-11"
                      onClick={() => setEditing(i)}
                    >
                      <Pencil aria-hidden="true" />
                      <span className="sr-only">Editar {i.description}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-11"
                      onClick={() => {
                        setRemoveError(null);
                        setRemoving(i);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      <span className="sr-only">Remover {i.description}</span>
                    </Button>
                  </div>
                )}
              </div>
              {short && (
                <div
                  data-testid="stock-warning"
                  className="flex flex-wrap items-center gap-x-3 text-sm"
                >
                  <span className="text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    Estoque atual: {i.stockQuantity} {i.unit}. Não dá para concluir assim.
                  </span>
                  <AdjustStockLink productId={i.productId!} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {adding === "PRODUCT" ? "Adicionar produto" : "Adicionar serviço"}
            </DialogTitle>
            <DialogDescription>
              {adding === "PRODUCT"
                ? status === "DONE"
                  ? "Toque no produto para adicionar. Como o atendimento já foi concluído, sai do estoque na hora."
                  : "Toque no produto para adicionar. O estoque só baixa ao concluir o atendimento."
                : "Toque no serviço para adicionar ao atendimento."}
            </DialogDescription>
          </DialogHeader>
          {adding === "PRODUCT" ? (
            <ProductTiles
              products={products}
              counts={productCounts}
              onPick={addProduct}
              disabled={addPending}
            />
          ) : (
            <ServiceTiles
              services={services}
              counts={serviceCounts}
              onPick={addService}
              disabled={addPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <EditItemForm
              key={editing.id}
              item={editing}
              status={status}
              onDone={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remover ${KIND_LABEL[removing?.kind ?? "SERVICE"]}?`}
        description={
          `“${removing?.description ?? ""}” será removido do atendimento.` +
          (removing?.kind === "PRODUCT" && status === "DONE" ? " O produto volta ao estoque." : "")
        }
        confirmLabel="Remover"
        pendingLabel="Removendo..."
        destructive
        error={removeError}
        onConfirm={async () => {
          if (!removing) return true;
          const r = await removeOrderItemAction(removing.id);
          if (!r.ok) {
            setRemoveError(r.error);
            return false;
          }
          toast.success(removing.kind === "PRODUCT" ? "Produto removido" : "Serviço removido");
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}

function EditItemForm({
  item,
  status,
  onDone,
}: {
  item: ItemView;
  status: Status;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(item.quantity);
  const [price, setPrice] = useState<number | null>(item.unitPriceCents);
  const [error, setError] = useState<string | null>(null);
  const [stockId, setStockId] = useState<number | null>(null);
  const priceOk = price !== null && !Number.isNaN(price) && price >= 0;
  const isProduct = item.kind === "PRODUCT";

  function save() {
    if (!priceOk) return;
    startTransition(async () => {
      const r = await updateOrderItemAction(item.id, { quantity, unitPriceCents: price });
      if (!r.ok) {
        setError(r.fieldErrors?.unitPriceCents ?? r.fieldErrors?.quantity ?? r.error);
        setStockId(stockProductIdOf(r.fieldErrors));
        return;
      }
      toast.success(isProduct ? "Produto atualizado" : "Serviço atualizado");
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isProduct ? "Editar produto" : "Editar serviço"}</DialogTitle>
        <DialogDescription className="[overflow-wrap:anywhere]">
          {item.description}
          {isProduct && (
            <>
              <br />
              Estoque atual: {item.stockQuantity} {item.unit}
              {status === "DONE" ? " (a baixa acompanha a nova quantidade)" : ""}
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2" role="group" aria-label="Quantidade">
          <Button
            type="button"
            variant="outline"
            className="size-11"
            disabled={quantity <= 1 || pending}
            onClick={() => setQuantity(quantity - 1)}
          >
            <Minus aria-hidden="true" />
            <span className="sr-only">Diminuir quantidade</span>
          </Button>
          <span className="w-10 text-center text-lg font-semibold tabular-nums">{quantity}</span>
          <Button
            type="button"
            variant="outline"
            className="size-11"
            disabled={quantity >= 999 || pending}
            onClick={() => setQuantity(quantity + 1)}
          >
            <Plus aria-hidden="true" />
            <span className="sr-only">Aumentar quantidade</span>
          </Button>
        </div>
        <MoneyInput
          aria-label="Preço unitário"
          value={price}
          onChange={(c) => {
            setPrice(c);
            setError(null);
          }}
          error={price === null ? "Informe o preço" : undefined}
          disabled={pending}
          className="h-12 text-lg"
        />
        {error && (
          <div className="flex flex-col gap-1">
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
            {stockId !== null && <AdjustStockLink productId={stockId} />}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          className="h-12 text-base"
          disabled={!priceOk || pending}
          onClick={save}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}
