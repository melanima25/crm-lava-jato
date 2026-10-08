import { afterAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/customers/test-db";

const t = await createTestDb();
afterAll(() => t.cleanup());

// Garante que `npm run test:pg` de fato fala com um PostgreSQL real (e o padrão com SQLite).
describe("banco dos testes", () => {
  it("usa o provider esperado", async () => {
    const expected = process.env.TEST_PG_URL ? "postgresql" : "sqlite";
    expect(t.provider).toBe(expected);
    if (expected === "postgresql") {
      const rows = await t.db.$queryRaw<{ v: string }[]>`select version() as v`;
      expect(rows[0].v).toMatch(/PostgreSQL/);
    } else {
      const rows = await t.db.$queryRaw<{ v: string }[]>`select sqlite_version() as v`;
      expect(rows[0].v).toMatch(/^\d/);
    }
  });
});
