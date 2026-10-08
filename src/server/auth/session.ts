// Sessão assinada (JWT HS256 via jose). Sem dependência de Prisma/Node APIs:
// pode ser importado pelo proxy.ts.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

export type SessionPayload = { userId: number };

const PLACEHOLDER = /^(dev-only|e2e-only)|troque|nao-usar|changeme|example/i;

/** Mensagem de erro se o segredo não serve (ausente, curto e, em produção, valor de exemplo); senão null. */
export function authSecretError(
  secret: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  if (!secret || secret.length < 32) {
    return "AUTH_SECRET ausente ou curto demais (mín. 32 caracteres). Gere um com: openssl rand -base64 32 (veja .env.example e docs/deploy.md).";
  }
  if (nodeEnv === "production" && (PLACEHOLDER.test(secret) || new Set(secret).size < 8)) {
    return "AUTH_SECRET em produção não pode ser o valor de exemplo/fraco. Gere um novo com: openssl rand -base64 32.";
  }
  return null;
}

function getKey(secret = process.env.AUTH_SECRET): Uint8Array {
  const error = authSecretError(secret);
  if (error) throw new Error(error);
  return new TextEncoder().encode(secret);
}

export async function signSession(
  payload: SessionPayload,
  opts: { secret?: string; now?: Date; maxAgeSeconds?: number } = {},
): Promise<string> {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return new SignJWT({ uid: payload.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS))
    .sign(getKey(opts.secret));
}

/** Retorna o payload se o token for válido (assinatura e expiração); senão null. */
export async function verifySession(
  token: string | undefined | null,
  opts: { secret?: string; now?: Date } = {},
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(opts.secret), {
      algorithms: ["HS256"],
      currentDate: opts.now,
    });
    const uid = payload.uid;
    return typeof uid === "number" && Number.isInteger(uid) ? { userId: uid } : null;
  } catch {
    return null;
  }
}
