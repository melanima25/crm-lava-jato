// Exige sessão válida em server actions/queries (defesa em profundidade: não depende só do proxy).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

/** Retorna a sessão ou redireciona para /login. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  return session;
}
