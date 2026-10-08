// Saldo devedor derivado (D-07/D-16, D-48): Σ(totalCents − paidCents) das OS `DONE` com saldo > 0.
// Módulo mínimo (sem importar o domínio de OS nem o de clientes) para ser usado por ambos.
import type { Prisma } from "@/generated/prisma/client";

type Reader = Pick<Prisma.TransactionClient, "serviceOrder">;

/** OS concluídas com saldo em aberto. `paidCents < totalCents` compara as duas colunas no banco. */
export function pendingOrdersWhere(
  db: Reader,
  extra: Prisma.ServiceOrderWhereInput = {},
): Prisma.ServiceOrderWhereInput {
  return {
    status: "DONE",
    paidCents: { lt: db.serviceOrder.fields.totalCents },
    ...extra,
  };
}

/** Saldo devedor por cliente (só entram clientes com saldo > 0). */
export async function getDebtByCustomer(
  db: Reader,
  customerIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (customerIds.length === 0) return out;
  const rows = await db.serviceOrder.findMany({
    where: pendingOrdersWhere(db, { customerId: { in: customerIds } }),
    select: { customerId: true, totalCents: true, paidCents: true },
  });
  for (const r of rows) {
    out.set(r.customerId, (out.get(r.customerId) ?? 0) + (r.totalCents - r.paidCents));
  }
  return out;
}
