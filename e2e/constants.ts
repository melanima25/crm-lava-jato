// Credenciais do usuário seed do banco de teste (prisma/test.db). Só para e2e.
export const TEST_USER = {
  email: "e2e@lavajato.test",
  name: "Usuário E2E",
  password: "senha-e2e-123456",
} as const;

export const TEST_AUTH_SECRET = "e2e-only-secret-0123456789-0123456789";
export const TEST_DB_URL = "file:./prisma/test.db";
