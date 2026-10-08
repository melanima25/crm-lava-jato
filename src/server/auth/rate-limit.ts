// Limite de tentativas de login guardado NO BANCO (tabela LoginAttempt), para valer entre
// instâncias serverless (D-43). Semântica: após MAX_FAILURES erros seguidos para a mesma chave
// (e-mail), bloqueia por LOCK_MS; um login com sucesso zera a contagem. Funciona em SQLite e Postgres.
import type { PrismaClient } from "@/generated/prisma/client";

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
/** Registros sem atividade há mais que isso (e sem bloqueio vigente) são apagados. */
export const STALE_MS = 24 * 60 * 60 * 1000;

export function createRateLimiter(
  db: PrismaClient,
  opts: { maxFailures?: number; lockMs?: number; staleMs?: number } = {},
) {
  const maxFailures = opts.maxFailures ?? MAX_FAILURES;
  const lockMs = opts.lockMs ?? LOCK_MS;
  const staleMs = opts.staleMs ?? STALE_MS;

  return {
    /** Segundos restantes de bloqueio (0 se liberado). */
    async retryAfterSeconds(key: string, now = Date.now()): Promise<number> {
      const e = await db.loginAttempt.findUnique({
        where: { key },
        select: { lockedUntil: true },
      });
      if (!e?.lockedUntil || e.lockedUntil.getTime() <= now) return 0;
      return Math.ceil((e.lockedUntil.getTime() - now) / 1000);
    },
    async recordFailure(key: string, now = Date.now()): Promise<void> {
      const at = new Date(now);
      // Limpeza simples de registros antigos (barata: índice em updatedAt).
      await db.loginAttempt.deleteMany({
        where: {
          updatedAt: { lt: new Date(now - staleMs) },
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: at } }],
        },
      });
      // Bloqueio anterior já expirou: recomeça a contagem.
      await db.loginAttempt.deleteMany({ where: { key, lockedUntil: { lte: at } } });
      // Incremento atômico (upsert nativo: INSERT ... ON CONFLICT DO UPDATE).
      const row = await db.loginAttempt.upsert({
        where: { key },
        create: { key, failures: 1, updatedAt: at },
        update: { failures: { increment: 1 }, updatedAt: at },
        select: { failures: true, lockedUntil: true },
      });
      if (row.failures >= maxFailures && !row.lockedUntil) {
        await db.loginAttempt.updateMany({
          where: { key, lockedUntil: null },
          data: { lockedUntil: new Date(now + lockMs), updatedAt: at },
        });
      }
    },
    async reset(key: string): Promise<void> {
      await db.loginAttempt.deleteMany({ where: { key } });
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
