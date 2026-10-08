// Criação segura do usuário de produção (D-44). Sem Next/cookies: testável e usada por prisma/seed-admin.ts.
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

const COMMON = new Set([
  "admin123",
  "administrador",
  "troque-esta-senha",
  "password",
  "senha123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "lavajato123",
]);

/** Retorna a mensagem de erro (em português) ou null se a senha é aceitável. */
export function checkAdminPassword(password: string, email = ""): string | null {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `A senha precisa ter pelo menos ${MIN_ADMIN_PASSWORD_LENGTH} caracteres.`;
  }
  const lower = password.toLowerCase();
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (COMMON.has(lower) || (local.length >= 4 && lower.includes(local))) {
    return "Senha fraca demais (comum ou parecida com o e-mail). Escolha outra.";
  }
  if (new Set(password).size < 5) return "Senha fraca demais (caracteres muito repetidos).";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) =>
    r.test(password),
  ).length;
  if (classes < 2) {
    return "Misture pelo menos dois tipos de caracteres (letras, números, símbolos ou espaços).";
  }
  return null;
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export type AdminInput = { email: string; name: string; password: string };

/** Valida as variáveis de ambiente ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME. */
export function parseAdminEnv(
  env: Record<string, string | undefined>,
): { ok: true; data: AdminInput } | { ok: false; error: string } {
  for (const k of ["ADMIN_EMAIL", "ADMIN_PASSWORD"]) {
    if (!env[k]) return { ok: false, error: `Variável ${k} não definida (veja docs/deploy.md).` };
  }
  const email = emailSchema.safeParse(env.ADMIN_EMAIL);
  if (!email.success) return { ok: false, error: "ADMIN_EMAIL não é um e-mail válido." };
  const password = env.ADMIN_PASSWORD as string;
  const weak = checkAdminPassword(password, email.data);
  if (weak) return { ok: false, error: `ADMIN_PASSWORD recusada: ${weak}` };
  const name = (env.ADMIN_NAME ?? "").trim() || "Administrador";
  return { ok: true, data: { email: email.data, name, password } };
}

/** Idempotente: cria o usuário ou atualiza nome/senha do existente (serve para redefinir a senha). */
export async function upsertAdmin(
  db: PrismaClient,
  input: AdminInput,
): Promise<"created" | "updated"> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  await db.user.upsert({
    where: { email: input.email },
    update: { name: input.name, passwordHash },
    create: { email: input.email, name: input.name, passwordHash },
  });
  return existing ? "updated" : "created";
}
