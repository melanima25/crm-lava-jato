import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/customers/test-db";
import { checkAdminPassword, parseAdminEnv, upsertAdmin } from "./admin-seed";

const t = await createTestDb();
afterAll(() => t.cleanup());

describe("checkAdminPassword", () => {
  it.each([
    ["curta", "Abc123!"],
    ["admin123", "admin123"],
    ["comum", "troque-esta-senha"],
    ["repetida", "aaaaaaaaaaaaaaaa"],
    ["um tipo só", "abcdefghijklmnop"],
    ["parecida com o e-mail", "dono.lavajato-2026"],
  ])("recusa senha %s", (_n, pw) => {
    expect(checkAdminPassword(pw, "dono.lavajato@gmail.com")).not.toBeNull();
  });
  it("aceita frase longa", () => {
    expect(checkAdminPassword("cafe com leite 2026", "x@y.com")).toBeNull();
    expect(checkAdminPassword("Vm7#qP2!xLw9Zc", "x@y.com")).toBeNull();
  });
});

describe("parseAdminEnv", () => {
  const ok = { ADMIN_EMAIL: " Dono@Lavajato.com ", ADMIN_PASSWORD: "cafe com leite 2026" };
  it("normaliza e usa nome padrão", () => {
    const r = parseAdminEnv(ok);
    expect(r).toEqual({
      ok: true,
      data: { email: "dono@lavajato.com", name: "Administrador", password: ok.ADMIN_PASSWORD },
    });
  });
  it("exige variáveis, e-mail válido e senha forte", () => {
    expect(parseAdminEnv({}).ok).toBe(false);
    expect(parseAdminEnv({ ADMIN_EMAIL: "x@y.com" }).ok).toBe(false);
    expect(parseAdminEnv({ ...ok, ADMIN_EMAIL: "não-é-email" }).ok).toBe(false);
    expect(parseAdminEnv({ ...ok, ADMIN_PASSWORD: "admin123" }).ok).toBe(false);
  });
});

describe("upsertAdmin", () => {
  it("é idempotente: cria e depois atualiza o mesmo usuário", async () => {
    const input = { email: "dono@lavajato.com", name: "Dono", password: "cafe com leite 2026" };
    expect(await upsertAdmin(t.db, input)).toBe("created");
    expect(await upsertAdmin(t.db, { ...input, password: "outra senha longa 77" })).toBe("updated");
    const users = await t.db.user.findMany();
    expect(users).toHaveLength(1);
    expect(await bcrypt.compare("outra senha longa 77", users[0].passwordHash)).toBe(true);
    expect(users[0].passwordHash).not.toContain("outra");
  });
});
