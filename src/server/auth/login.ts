// Lógica de autenticação (sem cookies/Next): testável com dependências injetadas.
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { RateLimiter } from "./rate-limit";

export const INVALID_CREDENTIALS = "E-mail ou senha inválidos";
export const TOO_MANY_ATTEMPTS = "Muitas tentativas. Tente novamente em alguns minutos.";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});

export type AuthUser = { id: number; passwordHash: string };

export type AuthDeps = {
  findUserByEmail: (email: string) => Promise<AuthUser | null>;
  limiter: RateLimiter;
  now?: () => number;
};

export type AuthResult = { ok: true; userId: number } | { ok: false; error: string };

// Hash de referência para gastar o mesmo tempo quando o usuário não existe.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("dummy-password-for-timing", 10);
  return dummyHash;
}

export async function authenticate(input: unknown, deps: AuthDeps): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_CREDENTIALS };
  const { email, password } = parsed.data;
  const now = deps.now?.() ?? Date.now();

  if ((await deps.limiter.retryAfterSeconds(email, now)) > 0) {
    return { ok: false, error: TOO_MANY_ATTEMPTS };
  }

  const user = await deps.findUserByEmail(email);
  // Compara sempre, mesmo sem usuário, para não revelar existência pelo tempo de resposta.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));

  if (!user || !valid) {
    await deps.limiter.recordFailure(email, now);
    return { ok: false, error: INVALID_CREDENTIALS };
  }
  await deps.limiter.reset(email);
  return { ok: true, userId: user.id };
}
