// Escolha do driver Prisma pelo esquema da URL (D-42):
//   file:...            -> better-sqlite3 (dev/testes)
//   postgres(ql)://...  -> node-postgres (produção/Neon; use a URL "pooled" em runtime)
// O client gerado em src/generated/prisma corresponde a UM dos dois (o mesmo `prisma generate`
// escolhe o schema pela DATABASE_URL — ver prisma.config.ts). Os `require` são preguiçosos de
// propósito: em produção o módulo nativo do SQLite nunca é carregado.
import type { Prisma } from "@/generated/prisma/client";

export type DbAdapter = NonNullable<Prisma.PrismaClientOptions["adapter"]>;

export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

/** Conexões por instância. Pequeno de propósito: cada instância serverless abre o seu pool. */
function poolMax(): number {
  const n = Number(process.env.DB_POOL_MAX);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

export function createAdapter(url: string | undefined = process.env.DATABASE_URL): DbAdapter {
  if (!url) throw new Error("DATABASE_URL não definida (veja .env.example).");
  if (isPostgresUrl(url)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaPg({
      connectionString: url,
      max: poolMax(),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  if (url.startsWith("file:")) {
    const { PrismaBetterSqlite3 } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3");
    return new PrismaBetterSqlite3({ url });
  }
  throw new Error(
    'DATABASE_URL inválida: use "file:./dev.db" (SQLite) ou "postgresql://..." (Postgres).',
  );
}
