"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  createCashCategoryAction,
  deleteCashCategoryAction,
  setCashCategoryActiveAction,
  updateCashCategoryAction,
} from "@/server/cash/actions";
import type { CashCategoryDTO } from "@/server/cash/queries";

type Direction = "IN" | "OUT";

const DIRECTION_LABEL: Record<Direction, string> = { IN: "Entrada", OUT: "Saída" };

function DirectionPicker({
  value,
  onChange,
  disabled,
}: {
  value: Direction;
  onChange: (d: Direction) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Tipo" className="grid grid-cols-2 gap-2">
      {(["OUT", "IN"] as const).map((d) => (
        <button
          key={d}
          type="button"
          disabled={disabled}
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={cn(
            "focus-visible:ring-ring/50 min-h-11 rounded-xl border-2 text-sm font-semibold outline-none focus-visible:ring-3 disabled:opacity-50",
            value === d
              ? d === "OUT"
                ? "border-red-400 bg-red-400/15 text-red-300"
                : "border-emerald-400 bg-emerald-400/15 text-emerald-300"
              : "bg-background hover:bg-muted",
          )}
        >
          {DIRECTION_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

/** Dica discreta do porquê de uma ação estar indisponível (também visível no celular, sem hover). */
function hintFor(c: CashCategoryDTO): string | null {
  if (c.isSystem) {
    return c.canInactivate
      ? "Categoria do sistema: não pode ser renomeada nem excluída."
      : "Categoria usada pelo sistema: não pode ser renomeada, excluída nem inativada.";
  }
  if (!c.canDelete)
    return "Já tem lançamentos: não pode ser excluída (inative-a se não for mais usar).";
  return null;
}

export function CategoryManager({ categories }: { categories: CashCategoryDTO[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newDirection, setNewDirection] = useState<Direction>("OUT");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  const [renaming, setRenaming] = useState<CashCategoryDTO | null>(null);
  const [inactivating, setInactivating] = useState<CashCategoryDTO | null>(null);
  const [deleting, setDeleting] = useState<CashCategoryDTO | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startCreate(async () => {
      const r = await createCashCategoryAction({ name: newName, direction: newDirection });
      if (!r.ok) {
        setCreateError(r.fieldErrors?.name ?? r.fieldErrors?.direction ?? r.error);
        return;
      }
      toast.success("Categoria criada");
      setNewName("");
      router.refresh();
    });
  }

  async function reactivate(c: CashCategoryDTO) {
    setBusyId(c.id);
    const r = await setCashCategoryActiveAction(c.id, true);
    setBusyId(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Categoria reativada");
    router.refresh();
  }

  async function confirmInactivate(): Promise<boolean> {
    if (!inactivating) return false;
    const r = await setCashCategoryActiveAction(inactivating.id, false);
    if (!r.ok) {
      setDialogError(r.error);
      return false;
    }
    toast.success("Categoria inativada");
    router.refresh();
    return true;
  }

  async function confirmDelete(): Promise<boolean> {
    if (!deleting) return false;
    const r = await deleteCashCategoryAction(deleting.id);
    if (!r.ok) {
      setDialogError(r.error);
      return false;
    }
    toast.success("Categoria excluída");
    router.refresh();
    return true;
  }

  function closeConfirm() {
    setInactivating(null);
    setDeleting(null);
    setDialogError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={create}
        noValidate
        className="bg-card flex flex-col gap-3 rounded-xl border p-3"
        aria-label="Nova categoria"
      >
        <h2 className="text-lg font-semibold">Nova categoria</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="cat-new-name">Nome</Label>
          <Input
            id="cat-new-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            autoComplete="off"
            aria-invalid={createError ? true : undefined}
            className="h-12 text-base"
            placeholder="Ex.: Energia elétrica"
          />
        </div>
        <DirectionPicker value={newDirection} onChange={setNewDirection} />
        {createError && (
          <p role="alert" className="text-destructive text-sm">
            {createError}
          </p>
        )}
        <Button type="submit" className="h-12" disabled={creating}>
          {creating && <Loader2 className="animate-spin" aria-hidden="true" />}
          {creating ? "Criando…" : "Adicionar categoria"}
        </Button>
      </form>

      {(["IN", "OUT"] as const).map((dir) => {
        const list = categories.filter((c) => c.direction === dir);
        return (
          <section
            key={dir}
            aria-label={dir === "IN" ? "Categorias de entrada" : "Categorias de saída"}
            className="flex flex-col gap-2"
          >
            <h2 className="text-lg font-semibold">{dir === "IN" ? "Entradas" : "Saídas"}</h2>
            {list.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
                Nenhuma categoria de {dir === "IN" ? "entrada" : "saída"}.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {list.map((c) => {
                  const hint = hintFor(c);
                  return (
                    <li
                      key={c.id}
                      data-testid={`category-${c.id}`}
                      className={cn(
                        "bg-card flex flex-col gap-2 rounded-xl border p-3",
                        !c.active && "opacity-80",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                        {c.isSystem && (
                          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                            Sistema
                          </span>
                        )}
                        {!c.active && (
                          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-300">
                            Inativa
                          </span>
                        )}
                        <span className="text-muted-foreground ml-auto text-sm">
                          {c.usageCount} {c.usageCount === 1 ? "lançamento" : "lançamentos"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          disabled={!c.canRename && !c.canChangeDirection}
                          title={
                            !c.canRename ? "Categoria do sistema não pode ser renomeada" : undefined
                          }
                          onClick={() => setRenaming(c)}
                        >
                          <Pencil aria-hidden="true" />
                          Renomear
                        </Button>
                        {c.active ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11"
                            disabled={!c.canInactivate}
                            title={
                              !c.canInactivate
                                ? "Usada pelo sistema: não pode ser inativada"
                                : undefined
                            }
                            onClick={() => {
                              setDialogError(null);
                              setInactivating(c);
                            }}
                          >
                            <Power aria-hidden="true" />
                            Inativar
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11"
                            disabled={busyId === c.id}
                            onClick={() => reactivate(c)}
                          >
                            {busyId === c.id ? (
                              <Loader2 className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Power aria-hidden="true" />
                            )}
                            Reativar
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          className="text-destructive h-11"
                          disabled={!c.canDelete}
                          title={
                            !c.canDelete
                              ? c.isSystem
                                ? "Categoria do sistema não pode ser excluída"
                                : "Categoria com lançamentos não pode ser excluída"
                              : undefined
                          }
                          onClick={() => {
                            setDialogError(null);
                            setDeleting(c);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                          Excluir
                        </Button>
                      </div>
                      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <RenameDialog category={renaming} onClose={() => setRenaming(null)} />

      <ConfirmDialog
        open={inactivating !== null}
        onOpenChange={(o) => !o && closeConfirm()}
        title="Inativar categoria?"
        description={`"${inactivating?.name ?? ""}" deixa de aparecer em novos lançamentos, mas continua no histórico. Você pode reativá-la depois.`}
        confirmLabel="Inativar"
        pendingLabel="Inativando…"
        error={dialogError}
        onConfirm={confirmInactivate}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && closeConfirm()}
        title="Excluir categoria?"
        description={`"${deleting?.name ?? ""}" será excluída. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        error={dialogError}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function RenameDialog({
  category,
  onClose,
}: {
  category: CashCategoryDTO | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {category && <RenameForm key={category.id} category={category} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ category, onClose }: { category: CashCategoryDTO; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [direction, setDirection] = useState<Direction>(category.direction);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: { name?: string; direction?: Direction } = {};
    if (category.canRename) input.name = name;
    if (category.canChangeDirection && direction !== category.direction)
      input.direction = direction;
    startTransition(async () => {
      const r = await updateCashCategoryAction(category.id, input);
      if (!r.ok) {
        setError(r.fieldErrors?.name ?? r.fieldErrors?.direction ?? r.error);
        return;
      }
      toast.success("Categoria atualizada");
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Editar categoria</DialogTitle>
        <DialogDescription>
          Renomear vale também para os lançamentos já feitos nesta categoria.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="cat-rename">Nome</Label>
        <Input
          id="cat-rename"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          disabled={!category.canRename}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          className="h-12 text-base"
        />
      </div>
      {category.canChangeDirection && (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Tipo (só enquanto não tem lançamentos)</span>
          <DirectionPicker value={direction} onChange={setDirection} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button type="submit" className="h-12" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
