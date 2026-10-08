/**
 * Recria o banco de teste (SQLite prisma/test.db, ou Postgres se E2E_PG_URL) do zero e aplica as migrations.
 * Roda antes do servidor do Playwright (ver webServer.command). Nunca toca no banco de dev.
 */
import Database from "better-sqlite3";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { TEST_DB_URL, TEST_USER } from "./constants";

const root = path.resolve(__dirname, "..");
// E2E_PG_URL definida (npm run test:e2e:pg): usa um Postgres real descartável em vez do SQLite.
const pgUrl = process.env.E2E_PG_URL;
const dbUrl = pgUrl ?? TEST_DB_URL;
const target = pgUrl ? "postgres" : "sqlite";

if (pgUrl) {
  // Banco descartável e vazio (embedded-postgres sobe um novo a cada execução): só aplica as migrations.
  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: pgUrl, DIRECT_URL: pgUrl, PRISMA_TARGET: target },
  });
} else {
  const dbFile = path.join(root, "prisma", "test.db");
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    rmSync(dbFile + suffix, { force: true });
  }
  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
  // WAL: o servidor (Prisma) e os helpers SQL dos testes (outros processos) usam o mesmo arquivo em
  // paralelo. No modo padrão (rollback journal) uma escrita curta de um processo trava leitores/escritores
  // dos outros e a transação do servidor estoura com P1008/SocketTimeout (500 + pageerror nos e2e). Com
  // WAL leitores não bloqueiam escritores. Só o banco de teste; produção é Postgres.
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.close();
}

// Cria o usuário de teste (senha conhecida) no banco de teste.
execSync("npx tsx prisma/seed.ts", {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: dbUrl,
    SEED_USER_EMAIL: TEST_USER.email,
    SEED_USER_NAME: TEST_USER.name,
    SEED_USER_PASSWORD: TEST_USER.password,
  },
});
