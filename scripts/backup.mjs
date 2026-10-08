// Backup lógico do banco PostgreSQL com pg_dump (formato custom, comprimido).
// Uso: npm run db:backup   (via run-prod: carrega .env.production.local)
// Requer o pg_dump instalado (cliente PostgreSQL 17 ou mais novo que o servidor). Não apaga nada.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("Defina DIRECT_URL (URL direta da Neon). Veja docs/deploy.md.");
  process.exit(1);
}
const dir = process.env.BACKUP_DIR || "backups";
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(dir, `crm-${stamp}.dump`);

const r = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", file, url],
  {
    stdio: ["ignore", "inherit", "inherit"],
  },
);
if (r.error && r.error.code === "ENOENT") {
  console.error(
    "pg_dump não encontrado. Instale o cliente do PostgreSQL (https://www.postgresql.org/download/)\n" +
      "ou use o backup agendado do GitHub Actions / o restore por ponto no tempo da Neon (docs/deploy.md).",
  );
  process.exit(1);
}
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`Backup gravado em ${file}`);
