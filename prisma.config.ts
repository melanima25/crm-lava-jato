import "dotenv/config";
import { defineConfig } from "prisma/config";

// Dois bancos, dois schemas/pastas de migrations (D-41):
//  - SQLite (dev/testes): prisma/schema.prisma + prisma/migrations
//  - PostgreSQL (produção/Neon): prisma/postgres/schema.prisma + prisma/postgres/migrations
// O alvo é inferido pelo esquema de DATABASE_URL (postgres:// ou postgresql:// = Postgres);
// PRISMA_TARGET=postgres|sqlite força o alvo.
const runtimeUrl = process.env["DATABASE_URL"] ?? "";
const forced = process.env["PRISMA_TARGET"];
const isPostgres = forced ? forced === "postgres" : /^postgres(ql)?:\/\//i.test(runtimeUrl);

export default defineConfig({
  schema: isPostgres ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isPostgres ? "prisma/postgres/migrations" : "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations usam a conexão DIRETA (DIRECT_URL); em runtime o app usa DATABASE_URL (pooled).
    url: isPostgres ? process.env["DIRECT_URL"] || runtimeUrl : runtimeUrl,
  },
});
