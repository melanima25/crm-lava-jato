// Helper de testes: cria um banco isolado com as migrations aplicadas.
//  - Padrão: SQLite temporário (prisma/migrations).
//  - TEST_PG_URL definida (npm run test:pg): um SCHEMA novo no Postgres real (prisma/postgres/migrations),
//    com o client Postgres gerado em src/generated/prisma-pg (scripts/pg-test-client.ts).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

export type TestDb = {
  db: PrismaClient;
  provider: "sqlite" | "postgresql";
  cleanup: () => Promise<void>;
};

function migrationSqlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((f) => readFileSync(path.join(dir, f, "migration.sql"), "utf8"));
}

async function createSqliteTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "crm-test-"));
  const url = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  for (const file of migrationSqlFiles(path.join(process.cwd(), "prisma", "migrations"))) {
    const sql = file
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const stmt of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.$executeRawUnsafe(stmt);
    }
  }

  return {
    db,
    provider: "sqlite",
    async cleanup() {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function createPostgresTestDb(url: string): Promise<TestDb> {
  const { Client } = await import("pg");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  // Client gerado à parte para não colidir com o client SQLite padrão.
  // Caminho em variável: não exige que o client Postgres exista para o typecheck do resto do projeto.
  const clientPath = "../../generated/prisma-pg/client.ts";
  const mod = (await import(/* @vite-ignore */ clientPath)) as {
    PrismaClient: typeof PrismaClient;
  };
  const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  for (const sql of migrationSqlFiles(
    path.join(process.cwd(), "prisma", "postgres", "migrations"),
  )) {
    await admin.query(sql);
  }
  await admin.end();

  const db = new mod.PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 8 }, { schema }),
  });
  return {
    db,
    provider: "postgresql",
    async cleanup() {
      await db.$disconnect();
      const c = new Client({ connectionString: url });
      await c.connect();
      await c.query(`DROP SCHEMA "${schema}" CASCADE`);
      await c.end();
    },
  };
}

export async function createTestDb(): Promise<TestDb> {
  const pgUrl = process.env.TEST_PG_URL;
  return pgUrl ? createPostgresTestDb(pgUrl) : createSqliteTestDb();
}
