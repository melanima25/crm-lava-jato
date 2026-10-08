import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, INVALID_CREDENTIALS, TOO_MANY_ATTEMPTS, type AuthDeps } from "./login";
import { createTestDb } from "@/server/customers/test-db";
import { createRateLimiter } from "./rate-limit";

const t = await createTestDb();
afterAll(() => t.cleanup());
beforeEach(async () => {
  await t.db.loginAttempt.deleteMany();
});

let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash("admin123", 4);
});

function deps(overrides: Partial<AuthDeps> = {}): AuthDeps {
  return {
    findUserByEmail: async (e) =>
      e === "admin@lavajato.local" ? { id: 1, passwordHash: hash } : null,
    limiter: createRateLimiter(t.db, { maxFailures: 3, lockMs: 60_000 }),
    now: () => 0,
    ...overrides,
  };
}
const creds = (email: string, password: string) => ({ email, password });

describe("authenticate", () => {
  it("aceita credenciais corretas (e-mail normalizado)", async () => {
    expect(await authenticate(creds("  Admin@LavaJato.local ", "admin123"), deps())).toEqual({
      ok: true,
      userId: 1,
    });
  });
  it("senha errada e usuário inexistente dão a mesma mensagem", async () => {
    const wrong = await authenticate(creds("admin@lavajato.local", "x"), deps());
    const missing = await authenticate(creds("nao@existe.com", "admin123"), deps());
    expect(wrong).toEqual({ ok: false, error: INVALID_CREDENTIALS });
    expect(missing).toEqual(wrong);
  });
  it("compara a senha mesmo com usuário inexistente", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await authenticate(creds("nao@existe.com", "admin123"), deps());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it("entrada inválida retorna erro genérico", async () => {
    const d = deps();
    expect(await authenticate({ email: "", password: "" }, d)).toEqual({
      ok: false,
      error: INVALID_CREDENTIALS,
    });
    expect(await authenticate({ email: null, password: 1 }, d)).toEqual({
      ok: false,
      error: INVALID_CREDENTIALS,
    });
  });
  it("bloqueia após N erros, mesmo com senha certa, e libera depois", async () => {
    let t = 0;
    const d = deps({ now: () => t });
    for (let i = 0; i < 3; i++) await authenticate(creds("admin@lavajato.local", "x"), d);
    expect(await authenticate(creds("admin@lavajato.local", "admin123"), d)).toEqual({
      ok: false,
      error: TOO_MANY_ATTEMPTS,
    });
    t = 61_000;
    expect((await authenticate(creds("admin@lavajato.local", "admin123"), d)).ok).toBe(true);
  });
  it("login correto zera o contador", async () => {
    const d = deps();
    await authenticate(creds("admin@lavajato.local", "x"), d);
    await authenticate(creds("admin@lavajato.local", "x"), d);
    await authenticate(creds("admin@lavajato.local", "admin123"), d);
    await authenticate(creds("admin@lavajato.local", "x"), d);
    expect((await authenticate(creds("admin@lavajato.local", "admin123"), d)).ok).toBe(true);
  });
});
