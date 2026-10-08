// Seed do usuário de PRODUÇÃO (npm run db:seed:prod). Lê ADMIN_EMAIL, ADMIN_PASSWORD e (opcional)
// ADMIN_NAME do ambiente; nunca usa senha padrão; recusa senha curta/fraca; idempotente.
// Também cria as categorias de caixa padrão (idempotente). Ver docs/deploy.md.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseAdminEnv, upsertAdmin } from "../src/server/auth/admin-seed";
import { ensureDefaultCashCategories } from "../src/server/cash/categories";
import { createAdapter } from "../src/server/db-adapter";

async function main() {
  const parsed = parseAdminEnv(process.env);
  if (!parsed.ok) {
    console.error(`Erro: ${parsed.error}`);
    process.exit(1);
  }
  // Conexão DIRETA (sem pooler) se informada; senão a URL normal.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const db = new PrismaClient({ adapter: createAdapter(url) });
  try {
    const result = await upsertAdmin(db, parsed.data);
    console.log(
      `Usuário "${parsed.data.email}" ${result === "created" ? "criado" : "atualizado (senha redefinida)"}.`,
    );
    const cats = await ensureDefaultCashCategories(db);
    console.log(`Categorias de caixa: ${cats} criada(s).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
