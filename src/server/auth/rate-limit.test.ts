import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/customers/test-db";
import { createRateLimiter } from "./rate-limit";

const t = await createTestDb();
const { db } = t;
afterAll(() => t.cleanup());
beforeEach(async () => {
  await db.loginAttempt.deleteMany();
});

describe("rate limiter (persistido no banco)", () => {
  const opts = { maxFailures: 3, lockMs: 1000 };
  it("bloqueia após N erros e libera após o prazo", async () => {
    const l = createRateLimiter(db, opts);
    await l.recordFailure("a", 0);
    await l.recordFailure("a", 0);
    expect(await l.retryAfterSeconds("a", 0)).toBe(0);
    await l.recordFailure("a", 0);
    expect(await l.retryAfterSeconds("a", 500)).toBe(1);
    expect(await l.retryAfterSeconds("a", 1000)).toBe(0);
  });
  it("recomeça a contagem após o bloqueio expirar", async () => {
    const l = createRateLimiter(db, opts);
    for (let i = 0; i < 3; i++) await l.recordFailure("a", 0);
    await l.recordFailure("a", 2000);
    expect(await l.retryAfterSeconds("a", 2000)).toBe(0);
    expect((await db.loginAttempt.findUnique({ where: { key: "a" } }))?.failures).toBe(1);
  });
  it("reset e chaves independentes", async () => {
    const l = createRateLimiter(db, opts);
    await l.recordFailure("a", 0);
    await l.recordFailure("a", 0);
    await l.reset("a");
    await l.recordFailure("a", 0);
    expect(await l.retryAfterSeconds("a", 0)).toBe(0);
    for (let i = 0; i < 3; i++) await l.recordFailure("b", 0);
    expect(await l.retryAfterSeconds("a", 0)).toBe(0);
    expect(await l.retryAfterSeconds("b", 0)).toBeGreaterThan(0);
  });
  it("estado compartilhado: outra instância do limiter enxerga o bloqueio", async () => {
    const one = createRateLimiter(db, opts);
    const other = createRateLimiter(db, opts);
    for (let i = 0; i < 3; i++) await one.recordFailure("x", 0);
    expect(await other.retryAfterSeconds("x", 0)).toBeGreaterThan(0);
  });
  it("falhas simultâneas não perdem contagem", async () => {
    const l = createRateLimiter(db, { maxFailures: 50, lockMs: 1000 });
    await Promise.all(Array.from({ length: 10 }, () => l.recordFailure("c", 0)));
    expect((await db.loginAttempt.findUnique({ where: { key: "c" } }))?.failures).toBe(10);
  });
  it("apaga registros antigos sem bloqueio vigente", async () => {
    const l = createRateLimiter(db, { ...opts, staleMs: 10_000 });
    await l.recordFailure("velho", 0);
    for (let i = 0; i < 3; i++) await l.recordFailure("bloqueado", 0);
    await l.recordFailure("novo", 100_000); // dispara a limpeza
    const keys = (await db.loginAttempt.findMany()).map((r) => r.key).sort();
    expect(keys).toEqual(["novo"]); // "bloqueado" também já expirou (lockMs 1000)
  });
  it("não apaga registro com bloqueio ainda vigente", async () => {
    const l = createRateLimiter(db, { maxFailures: 1, lockMs: 1_000_000, staleMs: 10_000 });
    await l.recordFailure("bloqueado", 0);
    await l.recordFailure("novo", 100_000);
    const keys = (await db.loginAttempt.findMany()).map((r) => r.key).sort();
    expect(keys).toEqual(["bloqueado", "novo"]);
  });
});
