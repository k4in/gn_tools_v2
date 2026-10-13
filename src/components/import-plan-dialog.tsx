import { useRef, useState, type ChangeEvent } from "react";
import { FileUp, Import } from "lucide-react";
import { Button } from "@/components/shadcn/button.tsx";
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
import { Textarea } from "@/components/shadcn/textarea.tsx";

export type ImportPlanDialogProps = {
  /** Ersetzt den Plan; gibt bei ungültigem JSON eine Fehlermeldung zurück. */
  onImport: (json: string) => string | null;
};

export function ImportPlanDialog({ onImport }: ImportPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setText("");
    setError(null);
  }

  function handleReplace() {
    const importError = onImport(text);
    if (importError) {
      setError(importError);
      return;
    }
    reset();
    setOpen(false);
  }

  /** Lädt eine exportierte Datei in das Textfeld, ersetzt wird erst mit „Plan ersetzen“. */
  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setText(await file.text());
      setError(null);
    } catch {
      setError("Datei konnte nicht gelesen werden.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="ghost" />}>
        <Import data-icon="inline-start" />
        Importieren
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Plan importieren</DialogTitle>
          <DialogDescription>
            JSON eines exportierten Plans einfügen oder als Datei laden, auch aus der alten Version. Steuern werden mit übernommen,
            Einstellungen nur, wenn der Export sie enthält.
          </DialogDescription>
        </DialogHeader>
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Der Import ersetzt den aktuellen Plan vollständig. Das lässt sich nicht rückgängig machen.
        </p>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="plan-import-json">Plan-JSON</FieldLabel>
          <Textarea
            id="plan-import-json"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            placeholder='{ "plan": [ { "id": "...", "kind": "tech", ... } ], "taxes": [] }'
            className="field-sizing-fixed max-h-[60vh] min-h-64 resize-none overflow-auto font-mono text-xs/relaxed"
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </Field>
        <DialogFooter>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleFile(event)}
          />
          <Button type="button" variant="outline" className="sm:mr-auto" onClick={() => fileInputRef.current?.click()}>
            <FileUp data-icon="inline-start" />
            Datei laden
          </Button>
          <DialogClose render={<Button type="button" variant="outline" />}>Abbrechen</DialogClose>
          <Button type="button" variant="destructive" disabled={!text.trim()} onClick={handleReplace}>
            Plan ersetzen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
