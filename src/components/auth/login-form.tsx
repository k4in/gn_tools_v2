import { useState, type FormEvent } from "react";
import { useConvex } from "convex/react";
import { LogIn } from "lucide-react";

import { api } from "@convex/_generated/api.ts";

import { getErrorMessage } from "@/lib/utils/get-error-message.ts";
import { normalizeUserKey } from "@/lib/utils/user-key.ts";
import { loginSchema } from "@/schemas/user.ts";
import { useUserKey } from "@/hooks/useUserKey.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/shadcn/field.tsx";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/shadcn/input-group.tsx";

export function LoginForm() {
  const convex = useConvex();
  const { saveUserKey } = useUserKey();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ key: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ungültiger Code.");
      return;
    }

    const key = normalizeUserKey(parsed.data.key);
    setIsSubmitting(true);
    try {
      const user = await convex.query(api.users.me, { key });
      if (user) saveUserKey(key);
      else setError("Diesen Code gibt es nicht.");
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="login-key">Du hast schon einen Code?</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="login-key"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-widest"
              aria-invalid={!!error || undefined}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" disabled={isSubmitting}>
                <LogIn data-icon="inline-start" />
                Einloggen
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </FieldGroup>
    </form>
  );
}
