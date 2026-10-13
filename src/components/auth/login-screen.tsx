import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card.tsx";
import { FieldSeparator } from "@/components/shadcn/field.tsx";
import { CreateUserForm } from "@/components/auth/create-user-form.tsx";
import { LoginForm } from "@/components/auth/login-form.tsx";

type LoginScreenProps = {
  /** Hinweis, z. B. wenn der gespeicherte Code unbekannt ist. */
  notice?: string;
};

/** Ohne Login gibt es keine App, nur diese Seite. */
export function LoginScreen({ notice }: LoginScreenProps) {
  return (
    <main className="flex min-h-svh items-start justify-center bg-background p-4 text-foreground sm:items-center sm:p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>GN Tools</CardTitle>
          <CardDescription>
            Gib einen Namen ein und erzeuge deinen persönlichen Code, oder logge dich mit deinem Code ein. Mit dem Code sind deine Pläne auf
            jedem Gerät verfügbar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {notice ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {notice}
            </p>
          ) : null}
          <CreateUserForm />
          <FieldSeparator>oder</FieldSeparator>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
