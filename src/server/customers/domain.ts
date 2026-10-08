// Regras de negócio de clientes e veículos. Sem cookies/Next: recebe o cliente Prisma por parâmetro.
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizePlate } from "@/lib/plate";
import { foldText, onlyDigits } from "@/lib/text";
import { getDebtByCustomer } from "@/server/orders/debt-balance";
import { customerInputSchema, idSchema, searchInputSchema, vehicleInputSchema } from "./schemas";

export type Db = PrismaClient;

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type VehicleType = "CAR" | "MOTORCYCLE";

export type VehicleDTO = {
  id: number;
  customerId: number;
  type: VehicleType;
  plate: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  notes: string | null;
  active: boolean;
};

export type CustomerDTO = {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
};

/** `debtCents`: saldo devedor derivado (OS concluídas em aberto); 0 se não deve nada (D-48). */
export type CustomerListItem = CustomerDTO & { activeVehicleCount: number; debtCents: number };
export type CustomerDetail = CustomerDTO & { vehicles: VehicleDTO[]; debtCents: number };

export const MSG = {
  invalidId: "Identificador inválido",
  customerNotFound: "Cliente não encontrado",
  vehicleNotFound: "Veículo não encontrado",
  customerInactive: "Cliente inativo. Reative o cliente antes.",
  invalidData: "Dados inválidos",
  customerHasOrders:
    "Este cliente tem atendimentos e não pode ser excluído. Use Inativar para tirá-lo das listas.",
  customerHasCanceledOrdersOnly:
    "Este cliente só tem atendimentos cancelados. Exclua os atendimentos cancelados primeiro (ou use Inativar).",
} as const;

export const plateTakenMessage = (ownerName: string) =>
  `Esta placa já está cadastrada para o cliente ${ownerName}`;

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

const vehicleSelect = {
  id: true,
  customerId: true,
  type: true,
  plate: true,
  brand: true,
  model: true,
  color: true,
  notes: true,
  active: true,
} as const;

const customerSelect = { id: true, name: true, phone: true, notes: true, active: true } as const;

// ---------- Clientes ----------

export async function createCustomer(db: Db, input: unknown): Promise<ActionResult<CustomerDTO>> {
  const p = customerInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const c = await db.customer.create({
    data: { ...p.data, searchName: foldText(p.data.name) },
    select: customerSelect,
  });
  return { ok: true, data: c };
}

export async function updateCustomer(
  db: Db,
  id: unknown,
  input: unknown,
): Promise<ActionResult<CustomerDTO>> {
  const cid = idSchema.safeParse(id);
  if (!cid.success) return fail(MSG.invalidId);
  const p = customerInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const exists = await db.customer.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!exists) return fail(MSG.customerNotFound);
  const c = await db.customer.update({
    where: { id: cid.data },
    data: { ...p.data, searchName: foldText(p.data.name) },
    select: customerSelect,
  });
  return { ok: true, data: c };
}

export async function setCustomerActive(
  db: Db,
  id: unknown,
  active: boolean,
): Promise<ActionResult<CustomerDTO>> {
  const cid = idSchema.safeParse(id);
  if (!cid.success) return fail(MSG.invalidId);
  const exists = await db.customer.findUnique({ where: { id: cid.data }, select: { id: true } });
  if (!exists) return fail(MSG.customerNotFound);
  const c = await db.customer.update({
    where: { id: cid.data },
    data: { active },
    select: customerSelect,
  });
  return { ok: true, data: c };
}

/**
 * Exclusão definitiva (D-47): só se o cliente não tem NENHUM atendimento (qualquer status).
 * Os veículos (que, por consequência, também não têm atendimento) saem junto, na mesma transação.
 * As FKs continuam Restrict: se uma OS surgir em paralelo, o banco recusa e a transação desfaz.
 */
export async function deleteCustomer(db: Db, id: unknown): Promise<ActionResult<{ id: number }>> {
  const cid = idSchema.safeParse(id);
  if (!cid.success) return fail(MSG.invalidId);
  try {
    return await db.$transaction(async (tx) => {
      const exists = await tx.customer.findUnique({
        where: { id: cid.data },
        select: { id: true },
      });
      if (!exists) return fail(MSG.customerNotFound);
      const total = await tx.serviceOrder.count({ where: { customerId: cid.data } });
      if (total > 0) {
        const notCanceled = await tx.serviceOrder.count({
          where: { customerId: cid.data, status: { not: "CANCELED" } },
        });
        return fail(notCanceled === 0 ? MSG.customerHasCanceledOrdersOnly : MSG.customerHasOrders);
      }
      await tx.vehicle.deleteMany({ where: { customerId: cid.data } });
      await tx.customer.delete({ where: { id: cid.data } });
      return { ok: true as const, data: { id: cid.data } };
    });
  } catch (e) {
    // Corrida: um atendimento foi criado entre a checagem e a exclusão (FK Restrict recusou).
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2003" || code === "P2014") return fail(MSG.customerHasOrders);
    throw e;
  }
}

/**
 * Filtro de busca compartilhado (clientes e /fiado): nome (contém, sem caixa/acento, via searchName),
 * telefone (dígitos parciais) e placa (normalizada parcial, em qualquer veículo, ativo ou não).
 * Retorna `{}` (sem filtro), `null` (busca só com símbolos: nada casa) ou um where de Customer.
 */
export function customerSearchWhere(q: string): { OR?: object[] } | null {
  // Prisma não escapa os curingas do LIKE (% e _): removê-los evita que "%" case com tudo.
  const text = foldText(q).replace(/[%_]/g, "").trim();
  const digits = onlyDigits(q);
  const plate = normalizePlate(q);

  const or: object[] = [];
  if (text) or.push({ searchName: { contains: text } });
  if (digits) or.push({ phone: { contains: digits } });
  if (plate) or.push({ vehicles: { some: { plate: { contains: plate } } } });
  // Busca preenchida, mas só com curingas/símbolos: nada a procurar, então nada casa.
  if (q.trim() && or.length === 0) return null;
  return or.length ? { OR: or } : {};
}

/** Busca única (ver `customerSearchWhere`). Ordena por nome; padrão só clientes ativos. */
export async function searchCustomers(db: Db, input: unknown = {}): Promise<CustomerListItem[]> {
  const { q, includeInactive } = searchInputSchema.parse(input);
  const filter = customerSearchWhere(q);
  if (filter === null) return [];

  const rows = await db.customer.findMany({
    where: { ...(includeInactive ? {} : { active: true }), ...filter },
    orderBy: [{ searchName: "asc" }, { id: "asc" }],
    select: {
      ...customerSelect,
      _count: { select: { vehicles: { where: { active: true } } } },
    },
  });
  const debts = await getDebtByCustomer(
    db,
    rows.map((r) => r.id),
  );
  return rows.map(({ _count, ...c }) => ({
    ...c,
    activeVehicleCount: _count.vehicles,
    debtCents: debts.get(c.id) ?? 0,
  }));
}

/** Cliente com todos os veículos (ativos primeiro, depois por id). null se não existir. */
export async function getCustomerDetail(db: Db, id: unknown): Promise<CustomerDetail | null> {
  const cid = idSchema.safeParse(id);
  if (!cid.success) return null;
  const c = await db.customer.findUnique({
    where: { id: cid.data },
    select: {
      ...customerSelect,
      vehicles: { select: vehicleSelect, orderBy: [{ active: "desc" }, { id: "asc" }] },
    },
  });
  if (!c) return null;
  const debts = await getDebtByCustomer(db, [c.id]);
  return { ...c, debtCents: debts.get(c.id) ?? 0 };
}

// ---------- Veículos ----------

/** Retorna o erro de duplicidade (com o nome do dono) se a placa já existir em outro veículo. */
async function checkPlate(db: Db, plate: string | null, ignoreVehicleId?: number) {
  if (!plate) return null;
  const other = await db.vehicle.findUnique({
    where: { plate },
    select: { id: true, customer: { select: { name: true } } },
  });
  if (!other || other.id === ignoreVehicleId) return null;
  const msg = plateTakenMessage(other.customer.name);
  return fail(msg, { plate: msg });
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

async function plateRace(db: Db, plate: string | null) {
  // Corrida entre a checagem e a gravação: recompõe a mensagem com o dono atual.
  return (
    (await checkPlate(db, plate)) ??
    fail("Esta placa já está cadastrada", { plate: "Placa já cadastrada" })
  );
}

export async function createVehicle(
  db: Db,
  customerId: unknown,
  input: unknown,
): Promise<ActionResult<VehicleDTO>> {
  const cid = idSchema.safeParse(customerId);
  if (!cid.success) return fail(MSG.invalidId);
  const p = vehicleInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const owner = await db.customer.findUnique({
    where: { id: cid.data },
    select: { active: true },
  });
  if (!owner) return fail(MSG.customerNotFound);
  if (!owner.active) return fail(MSG.customerInactive);
  const dup = await checkPlate(db, p.data.plate);
  if (dup) return dup;
  try {
    const v = await db.vehicle.create({
      data: { ...p.data, customerId: cid.data },
      select: vehicleSelect,
    });
    return { ok: true, data: v };
  } catch (e) {
    if (isUniqueViolation(e)) return plateRace(db, p.data.plate);
    throw e;
  }
}

/** Edita o veículo. `input.customerId` opcional transfere o veículo para outro cliente ativo. */
export async function updateVehicle(
  db: Db,
  id: unknown,
  input: unknown,
): Promise<ActionResult<VehicleDTO>> {
  const vid = idSchema.safeParse(id);
  if (!vid.success) return fail(MSG.invalidId);
  const p = vehicleInputSchema.safeParse(input);
  if (!p.success) return zodFail(p.error.issues);
  const current = await db.vehicle.findUnique({
    where: { id: vid.data },
    select: { id: true, customerId: true },
  });
  if (!current) return fail(MSG.vehicleNotFound);

  let customerId = current.customerId;
  const rawCustomerId = (input as { customerId?: unknown } | null)?.customerId;
  if (rawCustomerId !== undefined && rawCustomerId !== null && rawCustomerId !== "") {
    const parsed = idSchema.safeParse(rawCustomerId);
    if (!parsed.success) return fail(MSG.invalidId);
    if (parsed.data !== current.customerId) {
      const target = await db.customer.findUnique({
        where: { id: parsed.data },
        select: { active: true },
      });
      if (!target) return fail(MSG.customerNotFound);
      if (!target.active) return fail(MSG.customerInactive);
      customerId = parsed.data;
    }
  }

  const dup = await checkPlate(db, p.data.plate, vid.data);
  if (dup) return dup;
  try {
    const v = await db.vehicle.update({
      where: { id: vid.data },
      data: { ...p.data, customerId },
      select: vehicleSelect,
    });
    return { ok: true, data: v };
  } catch (e) {
    if (isUniqueViolation(e)) return plateRace(db, p.data.plate);
    throw e;
  }
}

export async function setVehicleActive(
  db: Db,
  id: unknown,
  active: boolean,
): Promise<ActionResult<VehicleDTO>> {
  const vid = idSchema.safeParse(id);
  if (!vid.success) return fail(MSG.invalidId);
  const v = await db.vehicle.findUnique({
    where: { id: vid.data },
    select: { customer: { select: { active: true } } },
  });
  if (!v) return fail(MSG.vehicleNotFound);
  if (active && !v.customer.active) return fail(MSG.customerInactive);
  const updated = await db.vehicle.update({
    where: { id: vid.data },
    data: { active },
    select: vehicleSelect,
  });
  return { ok: true, data: updated };
}
