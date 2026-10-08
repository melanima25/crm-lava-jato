// Schemas Zod do catálogo (serviços e produtos). Dinheiro em centavos inteiros.
import { z } from "zod";

export const MAX_PRICE_CENTS = 99_999_999; // R$ 999.999,99

/** Texto opcional: aparado; vazio/ausente vira null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * Preço opcional em centavos. Vazio (undefined, null, "") = null = "não oferecido".
 * Quando informado deve ser inteiro > 0 (sem negativos, sem zero, sem decimais).
 */
const optionalPrice = z.preprocess(
  (v) => (v === "" ? null : v),
  z
    .number({ error: "Preço inválido" })
    .int("O preço deve ser em centavos inteiros")
    .min(1, "O preço deve ser maior que zero")
    .max(MAX_PRICE_CENTS, "Preço acima do limite permitido")
    .nullish()
    .transform((v) => v ?? null),
);

export const MAX_MIN_STOCK = 999_999;

/**
 * Estoque mínimo (alerta de estoque baixo), opcional. "" / null = sem alerta; ausente (undefined) =
 * não alterar na edição (e sem alerta na criação). Quando informado: inteiro >= 0.
 */
const optionalMinStock = z.preprocess(
  (v) => (v === "" ? null : v),
  z
    .number({ error: "Estoque mínimo inválido" })
    .int("O estoque mínimo deve ser um número inteiro")
    .min(0, "O estoque mínimo não pode ser negativo")
    .max(MAX_MIN_STOCK, "Estoque mínimo acima do limite permitido")
    .nullish(),
);

const nameField = z
  .string({ error: "Informe o nome" })
  .trim()
  .min(2, "O nome deve ter ao menos 2 caracteres")
  .max(120, "O nome deve ter no máximo 120 caracteres");

export const NO_PRICE_MESSAGE = "Informe ao menos um preço (Carro ou Moto)";

export const serviceInputSchema = z
  .object({
    name: nameField,
    description: optionalText(500, "Descrição"),
    carPriceCents: optionalPrice,
    motorcyclePriceCents: optionalPrice,
  })
  .superRefine((v, ctx) => {
    if (v.carPriceCents === null && v.motorcyclePriceCents === null) {
      // Erro nos dois campos de preço para o formulário destacá-los.
      ctx.addIssue({ code: "custom", path: ["carPriceCents"], message: NO_PRICE_MESSAGE });
      ctx.addIssue({ code: "custom", path: ["motorcyclePriceCents"], message: NO_PRICE_MESSAGE });
    }
  });

export const productInputSchema = z.object({
  name: nameField,
  description: optionalText(500, "Descrição"),
  unit: z
    .string()
    .trim()
    .max(20, "A unidade deve ter no máximo 20 caracteres")
    .nullish()
    .transform((v) => (v ? v : "un")),
  salePriceCents: optionalPrice,
  minStockQuantity: optionalMinStock,
});

export const idSchema = z.coerce.number().int().positive();

export const catalogSearchSchema = z.object({
  q: z.string().max(120).optional().default(""),
  includeInactive: z.boolean().optional().default(false),
});

export type ServiceInput = z.input<typeof serviceInputSchema>;
export type ProductInput = z.input<typeof productInputSchema>;
