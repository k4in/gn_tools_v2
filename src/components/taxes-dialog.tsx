import { useEffect, useMemo, useState } from "react";
import { Percent, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/shadcn/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/shadcn/dialog.tsx";
import { Input } from "@/components/shadcn/input.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/shadcn/input-group.tsx";
import { normalizeTaxes, taxRatesAt, type TaxSegment } from "@/lib/calculate-fastest-way-to-goal.ts";
import { cn } from "@/lib/utils/cn.ts";

export type TaxesDialogProps = {
  taxes: TaxSegment[];
  currentTick: number;
  onApply: (taxes: TaxSegment[]) => void;
};

type DraftRow = {
  id: string;
  fromTick: string;
  met: string;
  kris: string;
};

function newRowId() {
  return Math.random().toString(36).slice(2, 10);
}

function toDraft(taxes: TaxSegment[]): DraftRow[] {
  return normalizeTaxes(taxes).map((seg) => ({
    id: newRowId(),
    fromTick: String(seg.fromTick),
    met: String(seg.met),
    kris: String(seg.kris),
  }));
}

function parsePercent(value: string): number | null {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.floor(n);
}

function parseRows(rows: DraftRow[]): { ok: true; taxes: TaxSegment[] } | { ok: false; error: string } {
  const parsed: TaxSegment[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const tickRaw = row.fromTick.trim();
    const metRaw = row.met.trim();
    const krisRaw = row.kris.trim();
    if (!tickRaw && !metRaw && !krisRaw) continue;
    if (!tickRaw || !metRaw || !krisRaw) {
      return { ok: false, error: "Jeder Abschnitt braucht Tick, Metall-% und Kristall-%." };
    }
    const fromTick = Number(tickRaw);
    if (!Number.isInteger(fromTick) || fromTick <= 0) {
      return { ok: false, error: "Tick muss eine ganze Zahl größer 0 sein." };
    }
    const met = parsePercent(metRaw);
    const kris = parsePercent(krisRaw);
    if (met === null || kris === null) {
      return { ok: false, error: "Steuern müssen zwischen 0 und 100 % liegen." };
    }
    if (seen.has(fromTick)) {
      return { ok: false, error: `Tick ${fromTick} ist mehrfach eingetragen.` };
    }
    seen.add(fromTick);
    parsed.push({ fromTick, met, kris });
  }
  return { ok: true, taxes: normalizeTaxes(parsed) };
}

function formatRates(rates: { met: number; kris: number }) {
  if (rates.met === rates.kris) return `${rates.met}%`;
  return `${rates.met}% / ${rates.kris}%`;
}

export function TaxesDialog({ taxes, currentTick, onApply }: TaxesDialogProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>(() => toDraft(taxes));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(toDraft(taxes));
    setError(null);
  }, [open, taxes]);

  const parsed = useMemo(() => parseRows(rows), [rows]);
  // Gesetzte Steuern greifen ab dem nächsten Tick; angezeigt wird, was fürs nächste Einkommen gilt.
  const currentRates = taxRatesAt(taxes, currentTick + 1);
  const hasTaxes = taxes.length > 0;
  const dirty = parsed.ok && JSON.stringify(parsed.taxes) !== JSON.stringify(normalizeTaxes(taxes));
  const canApply = parsed.ok && dirty;

  function updateRow(id: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <Percent data-icon="inline-start" />
        Steuern
        {hasTaxes ? <span className="font-normal text-muted-foreground tabular-nums">{formatRates(currentRates)}</span> : null}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Steuern</DialogTitle>
          <DialogDescription>
            Ab Tick 0 gelten immer 0%. Jeder Abschnitt gilt bis zum nächsten Eintrag, der letzte bis zum Planende. Steuern reduzieren das
            Metall- und Kristall-Einkommen (Minen und Extraktoren).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            <span>Ab Tick</span>
            <span>Metall</span>
            <span>Kristall</span>
            <span className="sr-only">Aktion</span>
          </div>
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <Input value="0" disabled className="tabular-nums" />
            <InputGroup>
              <InputGroupInput value="0" disabled className="tabular-nums" />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            <InputGroup>
              <InputGroupInput value="0" disabled className="tabular-nums" />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            <span className="size-7" />
          </div>
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={row.fromTick}
                className="tabular-nums"
                onChange={(event) => updateRow(row.id, { fromTick: event.target.value })}
              />
              <InputGroup>
                <InputGroupInput
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={row.met}
                  className="tabular-nums"
                  onChange={(event) => updateRow(row.id, { met: event.target.value })}
                />
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              </InputGroup>
              <InputGroup>
                <InputGroupInput
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={row.kris}
                  className="tabular-nums"
                  onChange={(event) => updateRow(row.id, { kris: event.target.value })}
                />
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              </InputGroup>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Abschnitt entfernen"
                onClick={() => {
                  setRows((prev) => prev.filter((item) => item.id !== row.id));
                  setError(null);
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            onClick={() => {
              setRows((prev) => [
                ...prev,
                {
                  id: newRowId(),
                  fromTick: String(Math.max(1, currentTick)),
                  met: "0",
                  kris: "0",
                },
              ]);
              setError(null);
            }}
          >
            <Plus data-icon="inline-start" />
            Abschnitt hinzufügen
          </Button>
        </div>
        <p className={cn("text-xs", error || !parsed.ok ? "text-destructive" : "text-muted-foreground")}>
          {error ?? (!parsed.ok ? parsed.error : "Der letzte Abschnitt gilt bis zum Ende.")}
        </p>
        <DialogFooter>
          <Button
            type="button"
            disabled={!canApply}
            onClick={() => {
              const next = parseRows(rows);
              if (!next.ok) {
                setError(next.error);
                return;
              }
              onApply(next.taxes);
              setOpen(false);
            }}
          >
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
