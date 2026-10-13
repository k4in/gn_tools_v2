import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";

import { useUserKey } from "@/hooks/useUserKey.tsx";
import { Button } from "@/components/shadcn/button.tsx";
import { Checkbox } from "@/components/shadcn/checkbox.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/shadcn/dialog.tsx";
import { Field, FieldLabel } from "@/components/shadcn/field.tsx";
import { UserKeyDisplay } from "@/components/auth/user-key-display.tsx";

type AccountDialogProps = {
  userKey: string;
  name: string;
};

/** Konto in der Tool-Leiste: Code anzeigen und ausloggen. */
export function AccountDialog({ userKey, name }: AccountDialogProps) {
  const { clearUserKey } = useUserKey();
  const [open, setOpen] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setHasSavedKey(false);
      }}
    >
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="icon-lg" aria-label="Konto" className="size-10 text-muted-foreground" />}
      >
        <UserRound />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eingeloggt als {name}</DialogTitle>
          <DialogDescription>
            Mit diesem Code loggst du dich auf anderen Geräten ein. Nach dem Ausloggen lässt er sich nicht wiederherstellen. Ohne Code sind
            deine Pläne verloren.
          </DialogDescription>
        </DialogHeader>
        <UserKeyDisplay userKey={userKey} />
        <Field orientation="horizontal">
          <Checkbox id="has-saved-key" checked={hasSavedKey} onCheckedChange={setHasSavedKey} />
          <FieldLabel htmlFor="has-saved-key">Ich habe meinen Code gesichert</FieldLabel>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Schließen</DialogClose>
          <Button type="button" variant="destructive" disabled={!hasSavedKey} onClick={clearUserKey}>
            <LogOut data-icon="inline-start" />
            Ausloggen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
