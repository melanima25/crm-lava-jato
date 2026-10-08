// Seed de EXEMPLO do catálogo de serviços — somente desenvolvimento (npm run db:seed:catalog).
// Idempotente: serviços já existentes (mesmo nome, sem acento/caixa) não são alterados.
//
// ATENÇÃO: OS PREÇOS ABAIXO SÃO PLACEHOLDERS inventados. O usuário não informou os valores reais;
// ajuste-os na tela /servicos. Não use este script em produção nem nos e2e.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createAdapter } from "../src/server/db-adapter";
import { foldText } from "../src/lib/text";

type Seed = {
  name: string;
  description?: string;
  carPriceCents: number;
  motorcyclePriceCents: number;
};

// Valores em centavos (PLACEHOLDER).
const SERVICES: Seed[] = [
  { name: "Lavagem simples", carPriceCents: 4000, motorcyclePriceCents: 2500 },
  { name: "Lavagem completa", carPriceCents: 7000, motorcyclePriceCents: 4000 },
  { name: "Lavagem detalhada", carPriceCents: 15000, motorcyclePriceCents: 8000 },
  { name: "Lavagem de motor", carPriceCents: 5000, motorcyclePriceCents: 3000 },
  { name: "Polimento de farol", carPriceCents: 8000, motorcyclePriceCents: 4000 },
  { name: "Revitalização de plásticos", carPriceCents: 6000, motorcyclePriceCents: 3500 },
  {
    name: "Cera",
    description: "Proteção da pintura",
    carPriceCents: 5000,
    motorcyclePriceCents: 3000,
  },
];

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("Variável DATABASE_URL não definida (veja .env.example).");
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("seed-catalog é só para desenvolvimento.");
  }
  const db = new PrismaClient({ adapter: createAdapter(url) });
  try {
    let created = 0;
    for (const s of SERVICES) {
      const searchName = foldText(s.name);
      const exists = await db.service.findUnique({ where: { searchName }, select: { id: true } });
      if (exists) continue;
      await db.service.create({ data: { ...s, searchName } });
      created++;
    }
    console.log(
      `Catálogo: ${created} serviço(s) criado(s), ${SERVICES.length - created} já existia(m). ` +
        "Preços são PLACEHOLDERS — ajuste em /servicos.",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
