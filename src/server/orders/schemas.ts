// Schemas Zod de atendimentos (OS) e pagamentos. Dinheiro em centavos inteiros.
import { z } from "zod";
import { MAX_PRICE_CENTS } from "@/server/catalog/schemas";

export const idSchema = z.coerce.number().int().positive();

const cents = (label: string) =>
  z
    .number({ error: `${label} inválido` })
    .int(`${label} deve ser em centavos inteiros`)
    .min(0, `${label} não pode ser negativo`)
    .max(MAX_PRICE_CENTS, `${label} acima do limite permitido`);

export const MAX_QUANTITY = 999;

const quantity = z
  .number({ error: "Quantidade inválida" })
  .int("A quantidade deve ser um número inteiro")
  .min(1, "A quantidade deve ser ao menos 1")
  .max(MAX_QUANTITY, `A quantidade deve ser no máximo ${MAX_QUANTITY}`);

/** Observação: aparada; "" vira null; ausente (undefined) = não alterar. */
const notesField = z
  .string()
  .trim()
  .max(1000, "Observações devem ter no máximo 1000 caracteres")
  .nullish()
  .transform((v) => (v === undefined ? undefined : v ? v : null));

const occurredAtField = z
  .union([z.date(), z.iso.datetime({ offset: true }).transform((s) => new Date(s))])
  .refine((d) => !Number.isNaN(d.getTime()), "Data inválida");

export const paymentMethodSchema = z.enum(["CASH", "PIX", "DEBIT_CARD", "CREDIT_CARD"], {
  error: "Forma de pagamento inválida",
});

export const paymentLineSchema = z.object({
  method: paymentMethodSchema,
  amountCents: cents("Valor").min(1, "O valor deve ser maior que zero"),
});

/** Lista vazia = Fiado. */
export const paymentLinesSchema = z.array(paymentLineSchema).max(10, "Linhas de pagamento demais");

export const addPaymentSchema = z.object({
  method: paymentMethodSchema,
  amountCents: cents("Valor").min(1, "O valor deve ser maior que zero"),
  /** Opcional; padrão = agora. Não pode ser futura. */
  occurredAt: occurredAtField.optional(),
});

export const newItemSchema = z.object({
  serviceId: idSchema,
  quantity: quantity.optional().default(1),
  /** Opcional: omitido = preço sugerido pelo tipo do veículo. */
  unitPriceCents: cents("Preço").optional(),
});

/** Item de produto (E9, D-15): preço omitido = `salePriceCents` do produto. */
export const newProductItemSchema = z.object({
  productId: idSchema,
  quantity: quantity.optional().default(1),
  unitPriceCents: cents("Preço").optional(),
});

export const updateItemSchema = z.object({
  quantity: quantity.optional(),
  unitPriceCents: cents("Preço").optional(),
});

export const createOrderSchema = z.object({
  customerId: idSchema,
  vehicleId: idSchema.nullish().transform((v) => v ?? null),
  occurredAt: occurredAtField.optional(),
  discountCents: cents("Desconto").optional().default(0),
  notes: notesField,
  /** Serviços já na criação (fluxo rápido). */
  items: z.array(newItemSchema).max(30, "Itens demais").optional().default([]),
  /** Produtos vendidos (E9). Atendimento só com produtos não exige veículo. */
  products: z.array(newProductItemSchema).max(30, "Itens demais").optional().default([]),
});

export const updateOrderSchema = z.object({
  /** undefined = manter; null = remover veículo (só sem serviços). */
  vehicleId: idSchema.nullable().optional(),
  discountCents: cents("Desconto").optional(),
  notes: notesField,
});

export const listOrdersSchema = z.object({
  /** "yyyy-mm-dd" (dia em America/Sao_Paulo). Padrão: hoje. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .optional(),
  /** Fim do intervalo (inclusivo), "yyyy-mm-dd". Padrão: mesmo dia de `date`. */
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .optional(),
  status: z.enum(["OPEN", "DONE", "CANCELED"]).optional(),
  customerId: idSchema.optional(),
});

export const dayCashSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .optional(),
});

export const vehicleTypeInputSchema = z.enum(["CAR", "MOTORCYCLE"], {
  error: "Tipo de veículo inválido",
});

/** Filtro de /fiado: busca (nome/telefone/placa) e ordenação ("oldest" padrão ou "balance"). */
export const debtorsFilterSchema = z.object({
  q: z.string().max(120).optional().default(""),
  sort: z.enum(["oldest", "balance"]).optional().default("oldest"),
});
