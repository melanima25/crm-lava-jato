import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";

// Checagem otimista (assinatura/expiração), sem banco. Autorização real fica nas actions/páginas.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = pathname === "/login";

  // Server actions (POST com header `next-action`) sem sessão: o redirect do proxy devolveria HTML
  // ao cliente e quebraria a tela. Deixa chegar à action — TODA action deve chamar requireSession(),
  // que redireciona ao /login no formato que o Next entende.
  if (!session && request.headers.has("next-action")) {
    return NextResponse.next();
  }

  if (!session && !isLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (session && isLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclui assets do Next, favicon e arquivos estáticos com extensão.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
