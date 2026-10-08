"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { authenticate } from "./login";
import { createRateLimiter } from "./rate-limit";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from "./session";

const loginLimiter = createRateLimiter(db);

export type LoginState = { error?: string };

/** Compatível com useActionState. Campos do form: "email" e "password". */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await authenticate(
    { email: formData.get("email"), password: formData.get("password") },
    {
      findUserByEmail: (email) =>
        db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } }),
      limiter: loginLimiter,
    },
  );
  if (!result.ok) return { error: result.error };

  const token = await signSession({ userId: result.userId });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
