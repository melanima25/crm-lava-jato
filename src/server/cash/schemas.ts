// Schemas Zod do caixa (lançamentos manuais, categorias, consultas). Dinheiro em centavos inteiros.
import { z } from "zod";
import { MAX_PRICE_CENTS } from "@/server/catalog/schemas";
import { idSchema, paymentMethodSchema } from "@/server/orders/schemas";

export const cashDirectionSchema = z.enum(["IN", "OUT"], {
  error: "Tipo inválido (entrada/saída)",
});

const occurredAtField = z
  .union([z.date(), z.iso.datetime({ offset: true }).transform((s) => new Date(s))])
  .refine((d) => !Number.isNaN(d.getTime()), "Data inválida");

/** Descrição opcional: aparada; "" vira null. */
const descriptionField = z
  .string()
  .trim()
  .max(200, "A descrição deve ter no máximo 200 caracteres")
  .nullish()
  .transform((v) => (v ? v : null));

/** Lançamento manual (criação e edição completa). Forma de pagamento obrigatória (modelo). */
export const cashEntryInputSchema = z.object({
  direction: cashDirectionSchema,
  amountCents: z
    .number({ error: "Valor inválido" })
    .int("O valor deve ser em centavos inteiros")
    .min(1, "O valor deve ser maior que zero")
    .max(MAX_PRICE_CENTS, "Valor acima do limite permitido"),
  categoryId: z
    .number({ error: "Selecione uma categoria" })
    .int("Selecione uma categoria")
    .positive("Selecione uma categoria"),
  method: paymentMethodSchema,
  /** ISO com offset; padrão = agora. Não pode ser futura. */
  occurredAt: occurredAtField.optional(),
  description: descriptionField,
});

const categoryName = z
  .string({ error: "Informe o nome da categoria" })
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Informe o nome da categoria")
      .max(60, "O nome deve ter no máximo 60 caracteres"),
  );

export const createCategorySchema = z.object({
  name: categoryName,
  direction: cashDirectionSchema,
});

export const updateCategorySchema = z.object({
  name: categoryName.optional(),
  /** Só permitido em categoria que nunca foi usada e não é de sistema. */
  direction: cashDirectionSchema.optional(),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

export const periodInputSchema = z.object({
  preset: z.enum(["today", "week", "month", "lastMonth", "custom"]).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const listEntriesSchema = periodInputSchema.extend({
  direction: cashDirectionSchema.optional(),
  /** id da categoria, ou "ORDERS" = só pagamentos de atendimento. */
  categoryId: z.union([idSchema, z.literal("ORDERS")]).optional(),
  method: paymentMethodSchema.optional(),
  q: z.string().max(120).optional(),
  /** Leniente: inválido = padrão; limit fica entre 1 e MAX_PAGE_SIZE. */
  page: z.coerce
    .number()
    .catch(1)
    .transform((n) => Math.max(1, Math.trunc(n))),
  limit: z.coerce
    .number()
    .catch(DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(n)))),
});
