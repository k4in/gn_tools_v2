import { useState } from "react";
import { ListRestart } from "lucide-react";
import { Button } from "@/components/shadcn/button.tsx";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/shadcn/combobox.tsx";
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

export type ResetPlanSource = {
  id: string;
  label: string;
};

export type ResetPlanDialogProps = {
  sources: ResetPlanSource[];
  onReset: (sourceId: string) => void;
  /** Auslöser rot statt dezent (z. B. mobil, wo er allein steht). */
  destructive?: boolean;
};

export function ResetPlanDialog({ sources, onReset, destructive = false }: ResetPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<ResetPlanSource | null>(sources[0] ?? null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSource(sources[0] ?? null);
      }}
    >
      <DialogTrigger
        render={
          destructive ? (
            <Button type="button" variant="destructive" />
          ) : (
            <Button type="button" variant="ghost" className="hover:bg-destructive/15 hover:text-destructive" />
          )
        }
      >
        <ListRestart data-icon="inline-start" />
        Zurücksetzen
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Plan zurücksetzen?</DialogTitle>
          <DialogDescription>
            Nur der aktuelle Plan wird gelöscht und ersetzt. Die anderen beiden Pläne bleiben unverändert. Das lässt sich nicht rückgängig
            machen.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Ersetzen durch</FieldLabel>
          <Combobox items={sources} value={source} onValueChange={setSource} itemToStringValue={(item) => item.label}>
            <ComboboxInput placeholder="Quelle wählen" />
            <ComboboxContent>
              <ComboboxEmpty>Keine Quelle gefunden.</ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item.id} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Abbrechen</DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!source}
            onClick={() => {
              if (!source) return;
              onReset(source.id);
              setOpen(false);
            }}
          >
            Plan ersetzen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
