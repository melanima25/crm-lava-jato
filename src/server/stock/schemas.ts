// Schemas Zod do estoque (E8). Quantidades em unidades INTEIRAS (D-25); dinheiro em centavos.
import { z } from "zod";
import { MAX_PRICE_CENTS } from "@/server/catalog/schemas";
import { idSchema, paymentMethodSchema } from "@/server/orders/schemas";

export const MAX_STOCK_QUANTITY = 999_999;

const occurredAtField = z
  .union([z.date(), z.iso.datetime({ offset: true }).transform((s) => new Date(s))])
  .refine((d) => !Number.isNaN(d.getTime()), "Data inválida");

/** Motivo opcional: aparado; "" vira null. */
const reasonField = z
  .string()
  .trim()
  .max(200, "O motivo deve ter no máximo 200 caracteres")
  .nullish()
  .transform((v) => (v ? v : null));

const positiveQuantity = z
  .number({ error: "Quantidade inválida" })
  .int("A quantidade deve ser um número inteiro")
  .min(1, "A quantidade deve ser maior que zero")
  .max(MAX_STOCK_QUANTITY, "Quantidade acima do limite permitido");

/** "Lançar compra no caixa": valor TOTAL da compra e forma de pagamento. */
export const purchaseSchema = z.object({
  amountCents: z
    .number({ error: "Valor inválido" })
    .int("O valor deve ser em centavos inteiros")
    .min(1, "O valor deve ser maior que zero")
    .max(MAX_PRICE_CENTS, "Valor acima do limite permitido"),
  method: paymentMethodSchema,
});

export const stockInSchema = z.object({
  productId: idSchema,
  quantity: positiveQuantity,
  reason: reasonField,
  /** ISO com offset ou Date; padrão agora; não pode ser futura. */
  occurredAt: occurredAtField.optional(),
  /** Ausente/null = o caixa não muda. */
  purchase: purchaseSchema.nullish().transform((v) => v ?? null),
});

export const stockOutSchema = z.object({
  productId: idSchema,
  quantity: positiveQuantity,
  reason: z
    .string({ error: "Informe o motivo da baixa" })
    .trim()
    .min(1, "Informe o motivo da baixa")
    .max(200, "O motivo deve ter no máximo 200 caracteres"),
  occurredAt: occurredAtField.optional(),
});

export const adjustStockSchema = z.object({
  productId: idSchema,
  /** Quantidade CONTADA no inventário (>= 0); o sistema grava a diferença. */
  countedQuantity: z
    .number({ error: "Quantidade contada inválida" })
    .int("A quantidade contada deve ser um número inteiro")
    .min(0, "A quantidade contada não pode ser negativa")
    .max(MAX_STOCK_QUANTITY, "Quantidade acima do limite permitido"),
  reason: reasonField,
  occurredAt: occurredAtField.optional(),
});

export const updateMovementSchema = z.object({
  /**
   * IN/OUT: quantidade positiva (o sinal vem do tipo). ADJUSTMENT: delta com sinal, diferente de zero.
   * A regra por tipo é validada no domínio.
   */
  quantity: z
    .number({ error: "Quantidade inválida" })
    .int("A quantidade deve ser um número inteiro")
    .refine((n) => n !== 0, "A quantidade não pode ser zero")
    .refine((n) => Math.abs(n) <= MAX_STOCK_QUANTITY, "Quantidade acima do limite permitido"),
  /** undefined = mantém; "" / null = remove o motivo. */
  reason: reasonField.optional(),
  occurredAt: occurredAtField.optional(),
  /**
   * Só IN. undefined = mantém a despesa ligada (acompanha data/descrição); null = remove a despesa;
   * objeto = cria ou atualiza a despesa ligada.
   */
  purchase: purchaseSchema.nullable().optional(),
});

export const listStockSchema = z.object({
  q: z.string().max(120).optional().default(""),
  includeInactive: z.boolean().optional().default(false),
  lowOnly: z.boolean().optional().default(false),
});

export const DEFAULT_HISTORY_LIMIT = 30;
export const MAX_HISTORY_LIMIT = 200;

export const historySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_HISTORY_LIMIT)
    .catch(DEFAULT_HISTORY_LIMIT)
    .default(DEFAULT_HISTORY_LIMIT),
});
