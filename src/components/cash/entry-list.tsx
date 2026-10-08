"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntryFormDialog, type EntryFormSetup } from "@/components/cash/entry-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/order-ui";
import { cn } from "@/lib/utils";
import { deleteCashEntryAction } from "@/server/cash/actions";
import type { CashCategoryDTO, CashEntryDTO } from "@/server/cash/queries";

function Amount({ e, className }: { e: CashEntryDTO; className?: string }) {
  const isIn = e.direction === "IN";
  return (
    <span
      data-direction={e.direction}
      className={cn(
        "font-semibold whitespace-nowrap tabular-nums",
        isIn ? "text-emerald-400" : "text-red-400",
        className,
      )}
    >
      {isIn ? "+" : "−"} {formatBRL(e.amountCents)}
    </span>
  );
}

function methodLabel(e: CashEntryDTO) {
  return PAYMENT_METHOD_LABEL[e.method as PaymentMethodValue];
}

function categoryLabel(e: CashEntryDTO) {
  if (e.kind === "ORDER_PAYMENT") return "Atendimentos";
  if (!e.category) return "Sem categoria";
  return e.category.active ? e.category.name : `${e.category.name} (inativa)`;
}

function Title({ e }: { e: CashEntryDTO }) {
  return e.orderId ? (
    <Link href={`/atendimentos/${e.orderId}`} className="font-medium hover:underline">
      {e.title}
    </Link>
  ) : (
    <span className="font-medium">{e.title}</span>
  );
}

function Details({ e }: { e: CashEntryDTO }) {
  const text = e.kind === "ORDER_PAYMENT" ? e.customerName : e.description;
  return text ? (
    <div className="text-muted-foreground text-sm [overflow-wrap:anywhere]">{text}</div>
  ) : null;
}

function Locked({ e }: { e: CashEntryDTO }) {
  if (e.editable || !e.lockedReason) return null;
  return <div className="text-muted-foreground mt-0.5 text-xs">{e.lockedReason}</div>;
}

/** Extrato: cartões no celular, tabela no desktop. Editar/Excluir só para lançamentos editáveis. */
export function EntryList({
  items,
  categories,
}: {
  items: CashEntryDTO[];
  categories: CashCategoryDTO[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EntryFormSetup | null>(null);
  const [deleting, setDeleting] = useState<CashEntryDTO | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete(): Promise<boolean> {
    if (!deleting) return false;
    const r = await deleteCashEntryAction(deleting.id);
    if (!r.ok) {
      setDeleteError(r.error);
      return false;
    }
    toast.success("Lançamento excluído");
    router.refresh();
    return true;
  }

  function actions(e: CashEntryDTO) {
    if (!e.editable) return null;
    return (
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-11"
          onClick={() => setEditing({ mode: "edit", entry: e })}
        >
          <Pencil aria-hidden="true" />
          Editar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-destructive h-11 min-w-11"
          onClick={() => {
            setDeleteError(null);
            setDeleting(e);
          }}
        >
          <Trash2 aria-hidden="true" />
          Excluir
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden" aria-label="Lançamentos">
        {items.map((e) => (
          <li key={e.id} className="bg-card flex flex-col gap-2 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <Title e={e} />
                <Details e={e} />
              </div>
              <Amount e={e} className="text-base" />{" "}
            </div>
            <div className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
              {formatDateTimeBR(e.occurredAt)} · {categoryLabel(e)} · {methodLabel(e)}
            </div>
            <Locked e={e} />
            {actions(e)}
          </li>
        ))}
      </ul>

      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Data e hora</TableHead>
              <TableHead>Lançamento</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="px-4 py-3 tabular-nums">
                  {formatDateTimeBR(e.occurredAt)}
                </TableCell>
                <TableCell className="max-w-xs [overflow-wrap:anywhere] whitespace-normal">
                  <Title e={e} />
                  <Details e={e} />
                  <Locked e={e} />
                </TableCell>
                <TableCell className="[overflow-wrap:anywhere] whitespace-normal">
                  {categoryLabel(e)}
                </TableCell>
                <TableCell>{methodLabel(e)}</TableCell>
                <TableCell className="text-right">
                  <Amount e={e} />
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex justify-end">{actions(e)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EntryFormDialog setup={editing} categories={categories} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        title="Excluir lançamento?"
        description={
          deleting
            ? `${deleting.direction === "IN" ? "Entrada" : "Saída"} de ${formatBRL(deleting.amountCents)} (${deleting.title}). Essa ação não pode ser desfeita e o saldo do caixa será recalculado.`
            : ""
        }
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        error={deleteError}
        onConfirm={confirmDelete}
      />
    </>
  );
}
