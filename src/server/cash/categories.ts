// Categorias padrão do caixa (docs/modelo-dados.md). Seed idempotente: pode rodar quantas vezes quiser.
import type { PrismaClient } from "@/generated/prisma/client";

export const DEFAULT_CASH_CATEGORIES: { name: string; direction: "IN" | "OUT" }[] = [
  { name: "Saldo inicial / aporte", direction: "IN" },
  { name: "Outras entradas", direction: "IN" },
  { name: "Compra de produtos", direction: "OUT" },
  { name: "Aluguel", direction: "OUT" },
  { name: "Água e luz", direction: "OUT" },
  { name: "Salários / diárias", direction: "OUT" },
  { name: "Manutenção de equipamentos", direction: "OUT" },
  { name: "Retirada do dono", direction: "OUT" },
  { name: "Outras despesas", direction: "OUT" },
];

/**
 * Categorias de SISTEMA (D-51): não podem ser excluídas, renomeadas nem trocar de direção.
 * Identificadas pelo par (nome, direção) — a unicidade sem acento/caixa impede que outra categoria
 * da mesma direção use o mesmo nome. `inactivatable: false` = o sistema depende dela.
 */
export type SystemCategoryKey = "OPENING_BALANCE" | "PRODUCT_PURCHASE";

export const SYSTEM_CASH_CATEGORIES: {
  key: SystemCategoryKey;
  name: string;
  direction: "IN" | "OUT";
  inactivatable: boolean;
}[] = [
  // Saldo de abertura do caixa: lançamento manual de entrada nesta categoria, na data de início.
  { key: "OPENING_BALANCE", name: "Saldo inicial / aporte", direction: "IN", inactivatable: true },
  // Compra de estoque (E8) lança aqui; inativá-la quebraria o "Lançar compra no caixa".
  { key: "PRODUCT_PURCHASE", name: "Compra de produtos", direction: "OUT", inactivatable: false },
];

export function systemCategoryKey(c: {
  name: string;
  direction: "IN" | "OUT";
}): SystemCategoryKey | null {
  return (
    SYSTEM_CASH_CATEGORIES.find((s) => s.name === c.name && s.direction === c.direction)?.key ??
    null
  );
}

/** Garante só as categorias de sistema (caminho de uso; não recria padrões que o usuário excluiu). */
export async function ensureSystemCashCategories(db: PrismaClient): Promise<void> {
  for (const c of SYSTEM_CASH_CATEGORIES) {
    const data = { name: c.name, direction: c.direction };
    const exists = await db.cashCategory.findUnique({
      where: { name_direction: data },
      select: { id: true },
    });
    if (exists) continue;
    try {
      await db.cashCategory.create({ data });
    } catch (e) {
      // Corrida com outra requisição que criou a mesma categoria: tudo bem se agora existe.
      const now = await db.cashCategory.findUnique({
        where: { name_direction: data },
        select: { id: true },
      });
      if (!now) throw e;
    }
  }
}

/** Cria as categorias que faltam; nunca altera nem reativa as existentes. Retorna quantas criou. */
export async function ensureDefaultCashCategories(db: PrismaClient): Promise<number> {
  let created = 0;
  for (const c of DEFAULT_CASH_CATEGORIES) {
    const exists = await db.cashCategory.findUnique({
      where: { name_direction: c },
      select: { id: true },
    });
    if (exists) continue;
    await db.cashCategory.create({ data: c });
    created++;
  }
  return created;
}
