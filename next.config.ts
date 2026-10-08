import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SQLite é só de dev/testes: o módulo nativo não deve ser empacotado (D-42).
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
};

export default nextConfig;
