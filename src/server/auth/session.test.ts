import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { authSecretError, signSession, verifySession } from "./session";

const secret = "a".repeat(40);

describe("session", () => {
  it("assina e verifica", async () => {
    const t = await signSession({ userId: 7 }, { secret });
    expect(await verifySession(t, { secret })).toEqual({ userId: 7 });
  });
  it("rejeita token expirado", async () => {
    const t = await signSession({ userId: 1 }, { secret, now: new Date("2020-01-01") });
    expect(await verifySession(t, { secret })).toBeNull();
  });
  it("aceita dentro dos 30 dias e rejeita depois", async () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const t = await signSession({ userId: 1 }, { secret, now: start });
    expect(
      await verifySession(t, { secret, now: new Date("2026-01-30T00:00:00Z") }),
    ).not.toBeNull();
    expect(await verifySession(t, { secret, now: new Date("2026-02-02T00:00:00Z") })).toBeNull();
  });
  it("rejeita token adulterado", async () => {
    const t = await signSession({ userId: 1 }, { secret });
    const [h, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: 2, exp: 9999999999 })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`, { secret })).toBeNull();
    expect(await verifySession(`${h}.${p}.x${s}`, { secret })).toBeNull();
  });
  it("rejeita segredo diferente, lixo, vazio e alg none", async () => {
    const t = await signSession({ userId: 1 }, { secret });
    expect(await verifySession(t, { secret: "b".repeat(40) })).toBeNull();
    expect(await verifySession("lixo", { secret })).toBeNull();
    expect(await verifySession(undefined, { secret })).toBeNull();
    const none = await new SignJWT({ uid: 1 })
      .setProtectedHeader({ alg: "HS512" })
      .sign(new TextEncoder().encode(secret));
    expect(await verifySession(none, { secret })).toBeNull();
  });
  it("exige segredo forte", async () => {
    await expect(signSession({ userId: 1 }, { secret: "curto" })).rejects.toThrow();
  });
});

describe("authSecretError", () => {
  it("recusa ausente ou curto", () => {
    expect(authSecretError(undefined, "production")).toMatch(/AUTH_SECRET/);
    expect(authSecretError("curto", "development")).toMatch(/32/);
  });
  it("em produção recusa valores de exemplo/fracos", () => {
    expect(
      authSecretError("dev-only-secret-troque-em-producao-min-32-chars", "production"),
    ).toMatch(/exemplo/);
    expect(authSecretError("a".repeat(40), "production")).toMatch(/fraco/);
  });
  it("aceita segredo forte em produção e o de dev fora dela", () => {
    expect(authSecretError("q8Zk2mV7xR1pL4nT9cB6yH3wJ5dF0sGa", "production")).toBeNull();
    expect(
      authSecretError("dev-only-secret-troque-em-producao-min-32-chars", "development"),
    ).toBeNull();
  });
});
