// Deriva o schema PostgreSQL (prisma/postgres/schema.prisma) do schema principal (SQLite, prisma/schema.prisma).
// A ÚNICA diferença permitida é o `provider` do datasource (e o caminho relativo do `output`).
// Uso: `npm run db:pg-schema` (grava) | `npm run db:pg-schema -- --check` (falha se divergiu).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MAIN_SCHEMA = path.join(root, "prisma", "schema.prisma");
export const PG_SCHEMA = path.join(root, "prisma", "postgres", "schema.prisma");

const HEADER =
  "// ARQUIVO GERADO por `npm run db:pg-schema` a partir de prisma/schema.prisma. NÃO EDITE À MÃO.\n" +
  '// Única diferença para o schema principal: provider = "postgresql" (D-41).\n\n';

/** Gera o texto do schema PostgreSQL. `output` = valor do generator (relativo ao arquivo gerado). */
export function derivePgSchema(main: string, output = "../../src/generated/prisma"): string {
  const provider = /provider(\s*)=(\s*)"sqlite"/g;
  const gen = /output(\s*)=(\s*)"\.\.\/src\/generated\/prisma"/g;
  if ((main.match(provider) ?? []).length !== 1) {
    throw new Error(
      'prisma/schema.prisma: esperado exatamente um datasource com provider "sqlite".',
    );
  }
  if ((main.match(gen) ?? []).length !== 1) {
    throw new Error(
      'prisma/schema.prisma: esperado generator com output "../src/generated/prisma".',
    );
  }
  return (
    HEADER +
    main.replace(provider, 'provider$1=$2"postgresql"').replace(gen, `output$1=$2"${output}"`)
  );
}

export function readMainSchema(): string {
  return readFileSync(MAIN_SCHEMA, "utf8").replace(/\r\n/g, "\n");
}

export function readPgSchema(): string {
  return readFileSync(PG_SCHEMA, "utf8").replace(/\r\n/g, "\n");
}

/** true se o arquivo PostgreSQL versionado está em dia com o principal. */
export function isPgSchemaInSync(): boolean {
  return readPgSchema() === derivePgSchema(readMainSchema());
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.includes("--check")) {
    if (!isPgSchemaInSync()) {
      console.error(
        "prisma/postgres/schema.prisma está DESATUALIZADO em relação a prisma/schema.prisma.\n" +
          "Rode `npm run db:pg-schema` e gere a migration Postgres (`npm run db:pg:migrate -- --name <nome>`).",
      );
      process.exit(1);
    }
    console.log("Schema Postgres em dia.");
  } else {
    writeFileSync(PG_SCHEMA, derivePgSchema(readMainSchema()));
    console.log("Gerado prisma/postgres/schema.prisma");
  }
}
