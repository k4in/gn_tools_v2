import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { KeyRound } from "lucide-react";

import { api } from "@convex/_generated/api.ts";

import { defaults } from "@/lib/gn-data/plan.ts";
import { generateUserKey } from "@/lib/features/generate-user-key.ts";
import { getErrorMessage } from "@/lib/utils/get-error-message.ts";
import { toStoredEntries } from "@/lib/utils/plan-data.ts";
import { createUserSchema } from "@/schemas/user.ts";
import { useUserKey } from "@/hooks/useUserKey.tsx";
import { Button } from "@/components/shadcn/button.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/shadcn/field.tsx";
import { Input } from "@/components/shadcn/input.tsx";

export function CreateUserForm() {
  const { saveUserKey } = useUserKey();
  const createUser = useMutation(api.users.create);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createUserSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ungültiger Name.");
      return;
    }

    const key = generateUserKey();
    setIsSubmitting(true);
    try {
      // Alle drei Slots starten mit der Standard-Vorlage.
      await createUser({ key, name: parsed.data.name, entries: toStoredEntries(defaults.plan) });
      saveUserKey(key, true);
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
          <FieldLabel htmlFor="create-user-name">Dein Name</FieldLabel>
          <Input
            id="create-user-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="z. B. Herbert"
            autoComplete="nickname"
            aria-invalid={!!error || undefined}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button type="submit" disabled={name.trim().length < 3 || isSubmitting}>
          <KeyRound data-icon="inline-start" />
          Neuen Code erzeugen
        </Button>
      </FieldGroup>
    </form>
  );
}
