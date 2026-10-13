import { useUserKey } from "@/hooks/useUserKey.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/alert-dialog.tsx";
import { UserKeyDisplay } from "@/components/auth/user-key-display.tsx";

type NewKeyDialogProps = {
  userKey: string;
};

/** Erscheint nur nach dem Erzeugen eines Codes, bis der Nutzer bestätigt, dass er ihn gesichert hat. */
export function NewKeyDialog({ userKey }: NewKeyDialogProps) {
  const { showNewKeyNotice, dismissNewKeyNotice } = useUserKey();

  return (
    <AlertDialog open={showNewKeyNotice}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Das ist dein Code</AlertDialogTitle>
          <AlertDialogDescription>
            Bewahre ihn sicher auf. Du brauchst ihn, um dich auf anderen Geräten einzuloggen. Ohne Code sind deine Pläne nicht
            wiederherstellbar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <UserKeyDisplay userKey={userKey} />
        <AlertDialogFooter>
          <AlertDialogAction onClick={dismissNewKeyNotice}>Ich habe meinen Code gesichert</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
