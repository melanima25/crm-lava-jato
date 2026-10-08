// Sobe um PostgreSQL REAL e descartável (pacote embedded-postgres, sem Docker), roda um comando
// com DATABASE_URL/DIRECT_URL apontando para ele e derruba o servidor ao final.
// Uso: node scripts/pg-local.mjs [--keep-schema] -- <comando...>
// Só para desenvolvimento/validação local; NUNCA aponta para banco de produção.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.PG_LOCAL_PORT ?? 54329);
const args = process.argv.slice(2);
const sep = args.indexOf("--");
const command = (sep >= 0 ? args.slice(sep + 1) : args).join(" ");
if (!command) {
  console.error("Uso: node scripts/pg-local.mjs -- <comando>");
  process.exit(2);
}

const dataDir = mkdtempSync(path.join(tmpdir(), "crm-pg-"));
const pg = new EmbeddedPostgres({
  databaseDir: path.join(dataDir, "data"),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  onLog: () => {},
  onError: (e) => console.error("[postgres]", e),
});

let stopped = false;
async function shutdown() {
  if (stopped) return;
  stopped = true;
  try {
    await pg.stop();
  } catch (e) {
    console.error("Falha ao parar o Postgres local:", e);
  }
  rmSync(dataDir, { recursive: true, force: true });
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(130)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(143)));

let code = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("crm");
  const url = `postgresql://postgres:postgres@localhost:${PORT}/crm`;
  console.log(`[pg-local] Postgres real em ${url}`);
  code = await new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: url,
        DIRECT_URL: url,
        TEST_PG_URL: url,
        E2E_PG_URL: url,
        PRISMA_TARGET: "postgres",
      },
    });
    child.on("exit", (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error(e);
} finally {
  await shutdown();
}
process.exit(code);
