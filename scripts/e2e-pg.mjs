// Roda a suíte e2e (Playwright) contra um Postgres real descartável (embedded-postgres).
// Troca o client gerado para o de Postgres durante a execução e SEMPRE restaura o do SQLite no fim.
// Uso: npm run test:e2e:pg [-- args do playwright]
import { spawnSync } from "node:child_process";

const extra = process.argv.slice(2).join(" ");
const sh = (cmd, env = {}) =>
  spawnSync(cmd, { shell: true, stdio: "inherit", env: { ...process.env, ...env } }).status ?? 1;

let code = 1;
try {
  code = sh("npx prisma generate --schema prisma/postgres/schema.prisma");
  if (code === 0) {
    code = sh(`node scripts/pg-local.mjs -- npx playwright test ${extra}`.trim());
  }
} finally {
  sh("npx prisma generate", { PRISMA_TARGET: "sqlite" });
}
process.exit(code);
