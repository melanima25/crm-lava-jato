// Schemas Zod de cliente e veículo (compartilháveis com os formulários).
import { z } from "zod";
import { isValidPlate, normalizePlate } from "@/lib/plate";
import { onlyDigits } from "@/lib/text";

/** Texto opcional: aparado; vazio/ausente vira null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

const phoneField = z
  .string()
  .nullish()
  .transform((v) => onlyDigits(v ?? "") || null)
  .refine((v) => v === null || (v.length >= 8 && v.length <= 13), {
    message: "Telefone inválido (informe DDD + número)",
  });

const plateField = z
  .string()
  .nullish()
  .transform((v) => normalizePlate(v ?? "") || null)
  .refine((v) => v === null || isValidPlate(v), {
    message: "Placa inválida (use ABC-1234 ou ABC-1D23)",
  });

export const customerInputSchema = z.object({
  name: z
    .string({ error: "Informe o nome" })
    .trim()
    .min(2, "O nome deve ter ao menos 2 caracteres")
    .max(120, "O nome deve ter no máximo 120 caracteres"),
  phone: phoneField,
  notes: optionalText(1000, "Observações"),
});

export const vehicleTypeSchema = z.enum(["CAR", "MOTORCYCLE"], {
  error: "Informe o tipo do veículo (Carro ou Moto)",
});

export const vehicleInputSchema = z.object({
  type: vehicleTypeSchema,
  plate: plateField,
  brand: optionalText(60, "Marca"),
  model: optionalText(60, "Modelo"),
  color: optionalText(40, "Cor"),
  notes: optionalText(500, "Observações"),
});

export const idSchema = z.coerce.number().int().positive();

export const searchInputSchema = z.object({
  q: z.string().max(120).optional().default(""),
  includeInactive: z.boolean().optional().default(false),
});

export type CustomerInput = z.input<typeof customerInputSchema>;
export type VehicleInput = z.input<typeof vehicleInputSchema>;
