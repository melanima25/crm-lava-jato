// Gera o client Prisma para PostgreSQL em src/generated/prisma-pg, usado só pelos testes contra
// Postgres (`npm run test:pg`). O client de produção (src/generated/prisma) não é tocado.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { derivePgSchema, readMainSchema } from "./pg-schema";

const file = path.resolve(process.cwd(), "prisma", "postgres", ".test-schema.prisma");
writeFileSync(file, derivePgSchema(readMainSchema(), "../../src/generated/prisma-pg"));
execSync(`npx prisma generate --schema "${file}"`, {
  stdio: "inherit",
  env: { ...process.env, PRISMA_TARGET: "postgres" },
});
