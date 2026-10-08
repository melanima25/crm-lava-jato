import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { ensureDefaultCashCategories } from "../src/server/cash/categories";
import { createAdapter } from "../src/server/db-adapter";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não definida (veja .env.example).`);
  return value;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "prisma/seed.ts é só para desenvolvimento/testes; em produção use `npm run db:seed:prod`.",
    );
  }
  const email = required("SEED_USER_EMAIL").trim().toLowerCase();
  const name = required("SEED_USER_NAME").trim();
  const password = required("SEED_USER_PASSWORD");
  const passwordHash = await bcrypt.hash(password, 10);

  const db = new PrismaClient({
    adapter: createAdapter(required("DATABASE_URL")),
  });
  try {
    await db.user.upsert({
      where: { email },
      update: { name, passwordHash },
      create: { email, name, passwordHash },
    });
    console.log(`Usuário "${email}" criado/atualizado.`);
    const cats = await ensureDefaultCashCategories(db);
    console.log(`Categorias de caixa: ${cats} criada(s) (idempotente).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
