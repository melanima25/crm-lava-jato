// Roda uma vez ao iniciar o servidor. Em produção, falha o boot com mensagem clara se a
// configuração essencial estiver ausente/fraca (D-44).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { authSecretError } = await import("@/server/auth/session");
  const problems = [
    authSecretError(process.env.AUTH_SECRET, "production"),
    process.env.DATABASE_URL ? null : "DATABASE_URL não definida (veja .env.example).",
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`Configuração de produção inválida:\n- ${problems.join("\n- ")}`);
  }
}
