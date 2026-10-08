"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/server/auth/actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <Card className="w-full max-w-sm shadow-2xl shadow-black/50">
      <CardHeader className="items-center gap-4 pt-2 text-center">
        <h1>
          <BrandMark size="lg" />
        </h1>
        <p className="text-muted-foreground text-sm">Entre para continuar</p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                autoFocus
                className="h-10"
              />
            </Field>
            <Field>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="h-10"
              />
            </Field>
          </FieldGroup>
          {state.error && <FieldError>{state.error}</FieldError>}
          <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
