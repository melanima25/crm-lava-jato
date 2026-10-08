import { PrismaClient } from "@/generated/prisma/client";
import { createAdapter } from "./db-adapter";

// Singleton: evita abrir várias conexões durante o hot reload do `next dev`.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({ adapter: createAdapter() });
}

export const db = globalForPrisma.prisma ?? createClient();

// Em produção (Vercel) cada instância tem o seu módulo; em dev preserva entre hot reloads.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
