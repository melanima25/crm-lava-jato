import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar | TZ Auto Estética" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_top,#1e2024_0%,#0e0e10_60%)] p-4">
      <LoginForm />
    </main>
  );
}
