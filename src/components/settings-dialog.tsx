import { useEffect, useState } from "react";
import { Settings, X } from "lucide-react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/shadcn/field.tsx";
import { Separator } from "@/components/shadcn/separator.tsx";
import { Input } from "@/components/shadcn/input.tsx";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/shadcn/input-group.tsx";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/shadcn/combobox.tsx";
import { HISTORY_WINDOW_TICKS, type HistoryWindow } from "@/lib/history-window.ts";
import { clockLabel } from "@/lib/calculate-fastest-way-to-goal.ts";
import { localDateKey, type PlanSettings } from "@/lib/utils/plan-data.ts";

const HISTORY_LABEL_RECENT = `−${HISTORY_WINDOW_TICKS} Ticks`;
const HISTORY_LABEL_ALL = "Alles anzeigen";
const HISTORY_WINDOW_ITEMS = [HISTORY_LABEL_RECENT, HISTORY_LABEL_ALL];

export type SettingsDialogProps = {
  /** Einstellungen des angesehenen Plan-Slots. */
  settings: PlanSettings;
  /** Legacy, nur zur Anzeige. */
  roundEndTick: number;
  onApply: (next: PlanSettings) => void;
};

function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Tick-Länge in Minuten, höchstens ein Tag. */
function parseTickMinutes(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 24 * 60) return null;
  return Math.floor(n);
}

export function SettingsDialog({ settings, roundEndTick, onApply }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(settings.startDate ?? "");
  const [time, setTime] = useState(settings.startTime);
  const [tickMinutes, setTickMinutes] = useState(String(settings.tickMinutes));
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>(settings.historyWindow);

  useEffect(() => {
    if (!open) return;
    setDate(settings.startDate ?? "");
    setTime(settings.startTime);
    setTickMinutes(String(settings.tickMinutes));
    setHistoryWindow(settings.historyWindow);
  }, [open, settings]);

  // Ohne Datum ist Tick 0 immer heute 00:00, die Uhrzeit spielt dann keine Rolle.
  const hasDate = date !== "";
  const normalizedTime = hasDate ? normalizeTime(time) : settings.startTime;
  const dateValid = !hasDate || isValidDate(date);
  const parsedTickMinutes = parseTickMinutes(tickMinutes);
  const next: PlanSettings | null =
    dateValid && normalizedTime && parsedTickMinutes !== null
      ? { startDate: hasDate ? date : null, startTime: normalizedTime, tickMinutes: parsedTickMinutes, historyWindow }
      : null;
  const dirty =
    next !== null &&
    (next.startDate !== settings.startDate ||
      next.startTime !== settings.startTime ||
      next.tickMinutes !== settings.tickMinutes ||
      next.historyWindow !== settings.historyWindow);

  /** Alle Änderungen gelten erst mit „Übernehmen“. */
  function apply() {
    if (!next) return;
    onApply(next);
    setOpen(false);
  }
  // Vorschau mit den eingegebenen Werten; bei kürzeren Ticks ist das reale Rundenende früher.
  const roundEndPreview = next
    ? clockLabel(
        {
          start_date: next.startDate ?? localDateKey(new Date()),
          start_time: next.startDate ? next.startTime : "00:00",
          tick_minutes: next.tickMinutes,
        },
        roundEndTick
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="icon-lg" aria-label="Einstellungen" />}>
        <Settings />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>Gelten nur für den aktuell angezeigten Plan.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <FieldSet>
            <FieldLegend>Runde</FieldLegend>
            <FieldDescription>
              Planstart ist Tick 0. Alle Zeiten im Planer rechnen sich von diesem Zeitpunkt. Ohne Datum ist Tick 0 immer heute um 00:00.
            </FieldDescription>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={!dateValid || undefined}>
                <FieldLabel htmlFor="settings-start-date">Datum</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="settings-start-date"
                    type="date"
                    value={date}
                    aria-invalid={!dateValid || undefined}
                    onChange={(event) => setDate(event.target.value)}
                  />
                  {hasDate ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="icon-xs" aria-label="Datum leeren" onClick={() => setDate("")}>
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              </Field>
              <Field data-invalid={!normalizedTime || undefined} data-disabled={!hasDate || undefined}>
                <FieldLabel htmlFor="settings-start-time">Uhrzeit</FieldLabel>
                <Input
                  id="settings-start-time"
                  type="time"
                  step={60}
                  value={hasDate ? time : "00:00"}
                  disabled={!hasDate}
                  aria-invalid={!normalizedTime || undefined}
                  onChange={(event) => setTime(event.target.value)}
                />
              </Field>
            </div>
            <Field data-invalid={parsedTickMinutes === null || undefined}>
              <FieldLabel htmlFor="settings-tick-minutes">Tick-Länge</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="settings-tick-minutes"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={tickMinutes}
                  aria-invalid={parsedTickMinutes === null || undefined}
                  className="tabular-nums"
                  onChange={(event) => setTickMinutes(event.target.value)}
                />
                <InputGroupAddon align="inline-end">Min</InputGroupAddon>
              </InputGroup>
              <FieldDescription>Dauer eines Ticks in Minuten.</FieldDescription>
            </Field>
            <Field data-disabled="true">
              <FieldLabel htmlFor="settings-round-end-tick">Voraussichtliche Rundenlänge</FieldLabel>
              {/* Legacy: Das Angriffs-Tool rechnet mit festen Stichtagen, die Einstellung bleibt für später erhalten. */}
              <InputGroup>
                <InputGroupInput
                  id="settings-round-end-tick"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={roundEndTick}
                  readOnly
                  disabled
                  className="tabular-nums"
                />
                <InputGroupAddon align="inline-end">Ticks</InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                Legacy-Einstellung, derzeit nicht änderbar.{roundEndPreview ? ` Ergibt ein Enddatum am ${roundEndPreview}.` : null}
              </FieldDescription>
            </Field>
          </FieldSet>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend>Anzeige</FieldLegend>
            <FieldDescription>Vergangenheit in Timeline und Tabellen. Die Zukunft bleibt immer sichtbar.</FieldDescription>
            <Field>
              <FieldLabel>Verlauf</FieldLabel>
              <Combobox
                items={HISTORY_WINDOW_ITEMS}
                value={historyWindow === "all" ? HISTORY_LABEL_ALL : HISTORY_LABEL_RECENT}
                onValueChange={(value) => {
                  if (value === HISTORY_LABEL_ALL) setHistoryWindow("all");
                  else if (value === HISTORY_LABEL_RECENT) setHistoryWindow("recent");
                }}
              >
                <ComboboxInput showTrigger className="w-full" />
                <ComboboxContent>
                  <ComboboxList>
                    <ComboboxItem value={HISTORY_LABEL_RECENT}>{HISTORY_LABEL_RECENT}</ComboboxItem>
                    <ComboboxItem value={HISTORY_LABEL_ALL}>{HISTORY_LABEL_ALL}</ComboboxItem>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Field>
          </FieldSet>
        </FieldGroup>
        <Separator />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Abbrechen</DialogClose>
          <Button type="button" disabled={!dirty} onClick={apply}>
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
