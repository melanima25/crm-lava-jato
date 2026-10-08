// Garante que o schema Postgres versionado não divergiu do schema principal (D-41).
import { describe, expect, it } from "vitest";
import { derivePgSchema, isPgSchemaInSync, readMainSchema, readPgSchema } from "./pg-schema";

describe("schema Postgres derivado", () => {
  it("está em dia com prisma/schema.prisma (rode `npm run db:pg-schema` se falhar)", () => {
    expect(isPgSchemaInSync()).toBe(true);
  });
  it("difere do principal SÓ no provider e no caminho do output", () => {
    const main = readMainSchema().split("\n");
    const pg = readPgSchema().split("\n").slice(3); // remove o cabeçalho gerado
    expect(pg).toHaveLength(main.length);
    const diff = main.flatMap((l, i) => (l === pg[i] ? [] : [[l.trim(), pg[i].trim()]]));
    expect(diff).toEqual([
      ['output   = "../src/generated/prisma"', 'output   = "../../src/generated/prisma"'],
      ['provider = "sqlite"', 'provider = "postgresql"'],
    ]);
  });
  it("detecta divergência", () => {
    expect(derivePgSchema(readMainSchema() + "\nmodel X { id Int @id }\n")).not.toBe(
      readPgSchema(),
    );
  });
});
