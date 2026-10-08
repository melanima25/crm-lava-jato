// Build de produção na Vercel: gera o client PostgreSQL, aplica as migrations pendentes na Neon
// (conexão DIRETA) e só então compila o Next. Se uma migration falhar, o deploy é abortado e a
// versão anterior continua no ar. Roda com `vercel-build` (a Vercel usa esse script automaticamente).
import { spawnSync } from "node:child_process";

const env = { ...process.env, PRISMA_TARGET: "postgres" };
const isPg = (u) => /^postgres(ql)?:\/\//i.test(u ?? "");

if (!isPg(env.DATABASE_URL)) {
  console.error(
    "DATABASE_URL ausente ou não é PostgreSQL. Configure as variáveis na Vercel (docs/deploy.md).",
  );
  process.exit(1);
}
if (!isPg(env.DIRECT_URL)) {
  console.error(
    "DIRECT_URL ausente. É a URL DIRETA da Neon (sem '-pooler'), usada para rodar as migrations.",
  );
  process.exit(1);
}
if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
  console.error("AUTH_SECRET ausente ou com menos de 32 caracteres (docs/deploy.md).");
  process.exit(1);
}

for (const cmd of ["npx prisma generate", "npx prisma migrate deploy", "npx next build"]) {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
