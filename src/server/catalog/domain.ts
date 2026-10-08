// Regras de negócio do catálogo (serviços e produtos). Sem cookies/Next: recebe o cliente Prisma.
import type { PrismaClient } from "@/generated/prisma/client";
import { foldText } from "@/lib/text";
import { catalogSearchSchema, idSchema, productInputSchema, serviceInputSchema } from "./schemas";

export type Db = PrismaClient;

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ServiceDTO = {
  id: number;
  name: string;
  description: string | null;
  /** null = não oferecido para carro */
  carPriceCents: number | null;
  /** null = não oferecido para moto */
  motorcyclePriceCents: number | null;
  active: boolean;
};

export type ProductDTO = {
  id: number;
  name: string;
  description: string | null;
  unit: string;
  /** null = produto só de uso interno */
  salePriceCents: number | null;
  stockQuantity: number;
  /** Alerta de estoque baixo quando estoque <= mínimo; null = sem alerta. */
  minStockQuantity: number | null;
  active: boolean;
};

export const MSG = {
  invalidId: "Identificador inválido",
  serviceNotFound: "Serviço não encontrado",
  productNotFound: "Produto não encontrado",
  invalidData: "Dados inválidos",
  serviceNameTaken: "Já existe um serviço com este nome",
  productNameTaken: "Já existe um produto com este nome",
  serviceInUse:
    "Este serviço já foi usado e não pode ser excluído. Use “Inativar” para tirá-lo das listas.",
  productInUse:
    "Este produto já foi usado ou tem movimentações de estoque e não pode ser excluído. Use “Inativar” para tirá-lo das listas.",
} as const;

function fail(error: string, fieldErrors?: Record<string, string>) {
  return { ok: false as const, error, fieldErrors };
}

function zodFail(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "");
    if (key && !(key in fieldErrors)) fieldErrors[key] = i.message;
  }
  return fail(issues[0]?.message ?? MSG.invalidData, fieldErrors);
}

function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

const serviceSelect = {
  id: true,
  name: true,
  description: true,
  carPriceCents: true,
  motorcyclePriceCents: true,
  active: true,
} as const;

const productSelect = {
  id: true,
  name: true,
  description: true,
  unit: true,
  salePriceCents: true,
  stockQuantity: true,
  minStockQuantity: true,
  active: true,
} as const;

/**
 * Exclusão definitiva só é permitida para itens nunca usados (D-35).
 *  - serviço: nenhum ServiceOrderItem com serviceId;
 *  - produto: nenhum ServiceOrderItem com productId e nenhuma StockMovement (E8).
 * O banco também protege via `onDelete: Restrict` nas FKs.
 */
export async function canHardDelete(
  db: Db,
  kind: "service" | "product",
  id: number,
): Promise<boolean> {
  if (kind === "service") {
    return (await db.serviceOrderItem.count({ where: { serviceId: id } })) === 0;
  }
  const [items, movements] = await Promise.all([
    db.serviceOrderItem.count({ where: { productId: id } }),
    db.stockMovement.count({ where: { productId: id } }),
  ]);
  return items === 0 && movements === 0;
}

/** Texto de busca sem acento/caixa e sem curingas de LIKE (% e _), que o Prisma não escapa. */
function searchText(q: string): string {
  return foldText(q).replace(/[%_]/g, "").trim();
}

// ---------- Serviços ----------

export async function createService(db: Db, input: unknown): Promise<ActionResult<ServiceDTO>> {
  const p = serviceInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const searchName = foldText(p.data.name);
  if (await db.service.findUnique({ where: { searchName }, select: { id: true } })) {
    return fail(MSG.serviceNameTaken, { name: MSG.serviceNameTaken });
  }
  try {
    const s = await db.service.create({ data: { ...p.data, searchName }, select: serviceSelect });
    return { ok: true, data: s };
  } catch (e) {
    if (errorCode(e) === "P2002") return fail(MSG.serviceNameTaken, { name: MSG.serviceNameTaken });
    throw e;
  }
}

export async function updateService(
  db: Db,
  id: unknown,
  input: unknown,
): Promise<ActionResult<ServiceDTO>> {
  const sid = idSchema.safeParse(id);
  if (!sid.success) return fail(MSG.invalidId);
  const p = serviceInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  if (!(await db.service.findUnique({ where: { id: sid.data }, select: { id: true } }))) {
    return fail(MSG.serviceNotFound);
  }
  const searchName = foldText(p.data.name);
  const other = await db.service.findUnique({ where: { searchName }, select: { id: true } });
  if (other && other.id !== sid.data) {
    return fail(MSG.serviceNameTaken, { name: MSG.serviceNameTaken });
  }
  try {
    const s = await db.service.update({
      where: { id: sid.data },
      data: { ...p.data, searchName },
      select: serviceSelect,
    });
    return { ok: true, data: s };
  } catch (e) {
    if (errorCode(e) === "P2002") return fail(MSG.serviceNameTaken, { name: MSG.serviceNameTaken });
    throw e;
  }
}

export async function setServiceActive(
  db: Db,
  id: unknown,
  active: boolean,
): Promise<ActionResult<ServiceDTO>> {
  const sid = idSchema.safeParse(id);
  if (!sid.success) return fail(MSG.invalidId);
  if (!(await db.service.findUnique({ where: { id: sid.data }, select: { id: true } }))) {
    return fail(MSG.serviceNotFound);
  }
  const s = await db.service.update({
    where: { id: sid.data },
    data: { active },
    select: serviceSelect,
  });
  return { ok: true, data: s };
}

export async function deleteService(db: Db, id: unknown): Promise<ActionResult<{ id: number }>> {
  const sid = idSchema.safeParse(id);
  if (!sid.success) return fail(MSG.invalidId);
  if (!(await db.service.findUnique({ where: { id: sid.data }, select: { id: true } }))) {
    return fail(MSG.serviceNotFound);
  }
  if (!(await canHardDelete(db, "service", sid.data))) return fail(MSG.serviceInUse);
  try {
    await db.service.delete({ where: { id: sid.data } });
  } catch (e) {
    // P2003: FK (Restrict) impediu a exclusão; P2025: já excluído por outra requisição.
    if (errorCode(e) === "P2003") return fail(MSG.serviceInUse);
    if (errorCode(e) === "P2025") return fail(MSG.serviceNotFound);
    throw e;
  }
  return { ok: true, data: { id: sid.data } };
}

/** Busca por nome (contém, sem caixa/acento). Padrão só ativos; ordena por nome. */
export async function searchServices(db: Db, input: unknown = {}): Promise<ServiceDTO[]> {
  const { q, includeInactive } = catalogSearchSchema.parse(input);
  const text = searchText(q);
  // Busca preenchida, mas só com curingas/símbolos: nada a procurar, então nada casa.
  if (q.trim() && !text) return [];
  return db.service.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(text ? { searchName: { contains: text } } : {}),
    },
    orderBy: [{ searchName: "asc" }, { id: "asc" }],
    select: serviceSelect,
  });
}

export async function getServiceById(db: Db, id: unknown): Promise<ServiceDTO | null> {
  const sid = idSchema.safeParse(id);
  if (!sid.success) return null;
  return db.service.findUnique({ where: { id: sid.data }, select: serviceSelect });
}

// ---------- Produtos ----------

export async function createProduct(db: Db, input: unknown): Promise<ActionResult<ProductDTO>> {
  const p = productInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const searchName = foldText(p.data.name);
  if (await db.product.findUnique({ where: { searchName }, select: { id: true } })) {
    return fail(MSG.productNameTaken, { name: MSG.productNameTaken });
  }
  try {
    const r = await db.product.create({ data: { ...p.data, searchName }, select: productSelect });
    return { ok: true, data: r };
  } catch (e) {
    if (errorCode(e) === "P2002") return fail(MSG.productNameTaken, { name: MSG.productNameTaken });
    throw e;
  }
}

export async function updateProduct(
  db: Db,
  id: unknown,
  input: unknown,
): Promise<ActionResult<ProductDTO>> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return fail(MSG.invalidId);
  const p = productInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  if (!(await db.product.findUnique({ where: { id: pid.data }, select: { id: true } }))) {
    return fail(MSG.productNotFound);
  }
  const searchName = foldText(p.data.name);
  const other = await db.product.findUnique({ where: { searchName }, select: { id: true } });
  if (other && other.id !== pid.data) {
    return fail(MSG.productNameTaken, { name: MSG.productNameTaken });
  }
  try {
    // stockQuantity nunca é tocado aqui: só movimentações (E8) o alteram. minStockQuantity ausente
    // (undefined) = mantém o valor atual.
    const r = await db.product.update({
      where: { id: pid.data },
      data: { ...p.data, searchName },
      select: productSelect,
    });
    return { ok: true, data: r };
  } catch (e) {
    if (errorCode(e) === "P2002") return fail(MSG.productNameTaken, { name: MSG.productNameTaken });
    throw e;
  }
}

export async function setProductActive(
  db: Db,
  id: unknown,
  active: boolean,
): Promise<ActionResult<ProductDTO>> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return fail(MSG.invalidId);
  if (!(await db.product.findUnique({ where: { id: pid.data }, select: { id: true } }))) {
    return fail(MSG.productNotFound);
  }
  const r = await db.product.update({
    where: { id: pid.data },
    data: { active },
    select: productSelect,
  });
  return { ok: true, data: r };
}

export async function deleteProduct(db: Db, id: unknown): Promise<ActionResult<{ id: number }>> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return fail(MSG.invalidId);
  if (!(await db.product.findUnique({ where: { id: pid.data }, select: { id: true } }))) {
    return fail(MSG.productNotFound);
  }
  if (!(await canHardDelete(db, "product", pid.data))) return fail(MSG.productInUse);
  try {
    await db.product.delete({ where: { id: pid.data } });
  } catch (e) {
    if (errorCode(e) === "P2003") return fail(MSG.productInUse);
    if (errorCode(e) === "P2025") return fail(MSG.productNotFound);
    throw e;
  }
  return { ok: true, data: { id: pid.data } };
}

export async function searchProducts(db: Db, input: unknown = {}): Promise<ProductDTO[]> {
  const { q, includeInactive } = catalogSearchSchema.parse(input);
  const text = searchText(q);
  if (q.trim() && !text) return [];
  return db.product.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(text ? { searchName: { contains: text } } : {}),
    },
    orderBy: [{ searchName: "asc" }, { id: "asc" }],
    select: productSelect,
  });
}

export async function getProductById(db: Db, id: unknown): Promise<ProductDTO | null> {
  const pid = idSchema.safeParse(id);
  if (!pid.success) return null;
  return db.product.findUnique({ where: { id: pid.data }, select: productSelect });
}
