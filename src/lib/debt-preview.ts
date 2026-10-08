// Prévia VISUAL da distribuição de um recebimento (o servidor é quem decide e grava, D-48..D-50).
export type PreviewOrder = { id: number; occurredAt: Date; balanceCents: number };

export type PreviewLine = {
  orderId: number;
  occurredAt: Date;
  amountCents: number;
  /** Quanto sobra em aberto no atendimento depois deste recebimento. */
  remainingCents: number;
};

/** Distribui `amountCents` do atendimento mais antigo para o mais novo (ordem recebida). */
export function previewDistribution(orders: PreviewOrder[], amountCents: number): PreviewLine[] {
  const lines: PreviewLine[] = [];
  let left = amountCents;
  for (const o of orders) {
    if (left <= 0) break;
    const part = Math.min(left, o.balanceCents);
    lines.push({
      orderId: o.id,
      occurredAt: o.occurredAt,
      amountCents: part,
      remainingCents: o.balanceCents - part,
    });
    left -= part;
  }
  return lines;
}
