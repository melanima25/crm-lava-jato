// Roda um comando contra o banco de PRODUÇÃO (Neon), carregando as variáveis de um arquivo local
// (padrão .env.production.local — nunca versionado) e forçando o alvo PostgreSQL.
// Uso: node scripts/run-prod.mjs [--env-file caminho] -- <comando...>
// Variáveis já definidas no terminal (ex.: ADMIN_PASSWORD) têm prioridade sobre o arquivo.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const own = sep >= 0 ? args.slice(0, sep) : [];
const command = (sep >= 0 ? args.slice(sep + 1) : args).join(" ");
const fileIdx = own.indexOf("--env-file");
const envFile = fileIdx >= 0 ? own[fileIdx + 1] : ".env.production.local";

if (!command) {
  console.error("Uso: node scripts/run-prod.mjs [--env-file arquivo] -- <comando>");
  process.exit(2);
}
if (existsSync(envFile)) {
  process.loadEnvFile(envFile); // não sobrescreve variáveis já existentes
  console.log(`[run-prod] variáveis carregadas de ${envFile}`);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error(
    `[run-prod] DIRECT_URL/DATABASE_URL ausente ou não é PostgreSQL.\n` +
      `Crie o arquivo ${envFile} com as URLs da Neon (veja docs/deploy.md).`,
  );
  process.exit(1);
}
// Mostra só o host (nunca a senha) para conferência.
console.log(`[run-prod] banco: ${new URL(url).host}`);

const child = spawn(command, {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, PRISMA_TARGET: "postgres", NODE_ENV: "production" },
});
child.on("exit", (c) => process.exit(c ?? 1));
