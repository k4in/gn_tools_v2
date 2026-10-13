// React
import { type ClipboardEvent, type ReactNode, useMemo, useRef } from "react";

// Packages
import { useQuery } from "convex/react";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react";

// Convex
import { api } from "@convex/_generated/api.ts";

// Lib/Utils
import { planSlotLabel, type PlanSlotId } from "@/lib/gn-data/plan.ts";
import {
  clockLabel,
  computeCurrentTick,
  formatRes,
  taxRatesAt,
  type StartConfig,
  type TaxSegment,
} from "@/lib/calculate-fastest-way-to-goal.ts";
import { calculateAttackProfit } from "@/lib/utils/attack-profit.ts";
import { cn } from "@/lib/utils/cn.ts";
import { parseAttackCalculations, type ParsedAttacker } from "@/lib/utils/parse-attack-calculation.ts";
import { configFromPlan, localDateKey, type StoredPlan } from "@/lib/utils/plan-data.ts";

// Hooks
import { useNow } from "@/hooks/useNow.tsx";
import { useStoredState } from "@/hooks/useStoredState.tsx";
import { useUserKey } from "@/hooks/useUserKey.tsx";

// Shadcn components
import { Button } from "@/components/shadcn/button.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card.tsx";
import { Field, FieldLabel } from "@/components/shadcn/field.tsx";
import { Input } from "@/components/shadcn/input.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/shadcn/input-group.tsx";
import { Textarea } from "@/components/shadcn/textarea.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shadcn/table.tsx";

// Components
import { PageLoading } from "@/components/page-loading.tsx";

const STORAGE_KEY = "gn_tool.attack-profit";
/** Auch nach Rundenende wird noch bis zu einem Jahr weitergerechnet, um den Turning Point zu zeigen. */
const HORIZON_DAYS = 365;
/** Stichtage in Tagen ab Rundenstart: ab hier wird „Profitabel in“ gelb, orange bzw. rot. */
const WARN_DAY = 70;
const LATE_DAY = 80;
const END_DAY = 90;
/** Stichtage, an denen der Mehrgewinn angezeigt wird. */
const GAIN_DAYS = [WARN_DAY, LATE_DAY];

type AttackRow = {
  id: string;
  /** Nur zur Erinnerung, welches Ziel zu den Werten gehört; wird nicht ausgewertet. */
  target: string;
  /** Wer angreift, z. B. „18:8 Lady“; ebenfalls nur zur Erinnerung. */
  attacker: string;
  capturedExtractors: string;
  costPerExtractor: string;
  /** Aus der eingefügten Angriffsberechnung erzeugt; wird bei jeder Textänderung neu aufgebaut. */
  fromPaste: boolean;
};

/** Steuern in Prozent, falls im Plan keine (passenden) gesetzt sind; gelten für den ganzen Zeitraum. */
type ManualTaxes = {
  met: string;
  kris: string;
};

type AttackDraft = {
  rows: AttackRow[];
  /** null = Steuern aus dem Plan. */
  manualTaxes: ManualTaxes | null;
  /** Eingefügte Angriffsberechnungen, eine Kopie nach der anderen. */
  pasteText: string;
};

function newRowId() {
  return Math.random().toString(36).slice(2, 10);
}

function newRow(): AttackRow {
  return { id: newRowId(), target: "", attacker: "", capturedExtractors: "0", costPerExtractor: "0", fromPaste: false };
}

function loadRow(raw: unknown): AttackRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.capturedExtractors !== "string" || typeof o.costPerExtractor !== "string") return null;
  return {
    id: typeof o.id === "string" ? o.id : newRowId(),
    // Früher landete der eingelesene Angreifer im Ziel-Feld.
    ...(typeof o.attacker !== "string" && o.fromPaste === true
      ? { target: "", attacker: typeof o.target === "string" ? o.target : "" }
      : { target: typeof o.target === "string" ? o.target : "", attacker: typeof o.attacker === "string" ? o.attacker : "" }),
    capturedExtractors: o.capturedExtractors,
    costPerExtractor: o.costPerExtractor,
    fromPaste: o.fromPaste === true,
  };
}

function loadManualTaxes(raw: unknown): ManualTaxes | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.met !== "string" || typeof o.kris !== "string") return null;
  return { met: o.met, kris: o.kris };
}

function loadDraft(raw: unknown): AttackDraft {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const manualTaxes = loadManualTaxes(o.manualTaxes);
  const pasteText = typeof o.pasteText === "string" ? o.pasteText : "";
  if (Array.isArray(o.rows)) return { rows: o.rows.map(loadRow).filter((row) => row !== null), manualTaxes, pasteText };
  // Früheres Format mit nur einer Eingabe wird zur ersten Zeile.
  const legacy = loadRow(o);
  return { rows: [legacy ?? newRow()], manualTaxes, pasteText };
}

function isEmptyRow(row: AttackRow): boolean {
  return (
    row.target.trim() === "" &&
    row.attacker.trim() === "" &&
    parseAmount(row.capturedExtractors) === 0 &&
    parseAmount(row.costPerExtractor) === 0
  );
}

/**
 * Baut die eingefügten Zeilen aus den eingelesenen Angreifern neu auf; manuell angelegte Zeilen bleiben,
 * leere werden dabei verworfen. ID und Ziel werden der Reihe nach weiterverwendet, damit die Zeilen stabil bleiben.
 */
function syncPastedRows(rows: AttackRow[], attackers: ParsedAttacker[]): AttackRow[] {
  const pasted = rows.filter((row) => row.fromPaste);
  const manual = rows.filter((row) => !row.fromPaste && (attackers.length === 0 || !isEmptyRow(row)));
  return [
    ...manual,
    ...attackers.map((attacker, i) => ({
      id: pasted[i]?.id ?? newRowId(),
      // Das Ziel steht nicht in der Angriffsberechnung und bleibt bei Textänderungen erhalten.
      target: pasted[i]?.target ?? "",
      attacker: attacker.name,
      capturedExtractors: String(attacker.capturedExtractors),
      costPerExtractor: String(attacker.costPerExtractor ?? 0),
      fromPaste: true,
    })),
  ];
}

function parseAmount(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parsePercent(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function ticksPerDay(cfg: StartConfig): number {
  return (24 * 60) / cfg.tick_minutes;
}

function formatDuration(ticks: number, cfg: StartConfig): string {
  const minutes = ticks * cfg.tick_minutes;
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  if (days === 0) return `${hours} Std.`;
  return hours === 0 ? `${days} ${days === 1 ? "Tag" : "Tage"}` : `${days} ${days === 1 ? "Tag" : "Tage"} ${hours} Std.`;
}

/** Tick, an dem der gegebene Tag ab Rundenstart beginnt; hängt von der Tick-Länge ab. */
function dayToTick(day: number, perDay: number): number {
  return Math.round(day * perDay);
}

function breakEvenClass(tick: number | null, perDay: number): string {
  if (tick === null || tick >= dayToTick(END_DAY, perDay)) return "text-destructive";
  if (tick >= dayToTick(LATE_DAY, perDay)) return "text-orange-500";
  if (tick >= dayToTick(WARN_DAY, perDay)) return "text-yellow-500";
  return "text-green-500";
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
      {hint ? <span className="text-[11px] text-muted-foreground tabular-nums">{hint}</span> : null}
    </div>
  );
}

function CellValue({ value, hint, className }: { value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("font-medium tabular-nums", className)}>{value}</span>
      {hint ? <span className="text-[11px] text-muted-foreground tabular-nums">{hint}</span> : null}
    </div>
  );
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${formatRes(n)}`;
}

type AttackResult = ReturnType<typeof calculateAttackProfit>;

function MobileValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function AmountInput({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (value: string) => void }) {
  return (
    <InputGroup>
      <InputGroupInput
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={label}
        className="tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <InputGroupAddon align="inline-end">{unit}</InputGroupAddon>
    </InputGroup>
  );
}

function LossValue({ result }: { result: AttackResult | null }) {
  return <CellValue value={result ? formatRes(result.loss) : "–"} />;
}

function BreakEvenValue({
  result,
  currentTick,
  cfg,
  perDay,
}: {
  result: AttackResult | null;
  currentTick: number;
  cfg: StartConfig;
  perDay: number;
}) {
  if (!result) return "–";
  const breakEvenTick = result.breakEvenTicks === null ? null : currentTick + result.breakEvenTicks;
  return (
    <CellValue
      className={breakEvenClass(breakEvenTick, perDay)}
      value={result.breakEvenTicks === null ? "nie" : formatDuration(result.breakEvenTicks, cfg)}
      hint={
        breakEvenTick === null
          ? "auch nicht innerhalb eines Jahres"
          : `Tick ${formatRes(breakEvenTick)} · ${clockLabel(cfg, breakEvenTick)}`
      }
    />
  );
}

function GainValue({ result, index }: { result: AttackResult | null; index: number }) {
  const gain = result?.gainsAt[index] ?? null;
  if (gain === null) return <CellValue value="–" hint={result ? "bereits vorbei" : null} />;
  return <CellValue className={gain >= 0 ? "text-green-500" : "text-destructive"} value={signed(gain)} />;
}

/** Lädt den aktiven Plan aus Convex; gerechnet wird immer mit ihm. */
export function AttackProfitPage() {
  const { userKey } = useUserKey();
  const plans = useQuery(api.plans.list, userKey ? { key: userKey } : "skip");
  const me = useQuery(api.users.me, userKey ? { key: userKey } : "skip");

  if (!plans || !me) return <PageLoading />;
  const planId = me.liveSlot ?? me.activeSlot;
  const plan = plans.find((item) => item.slot === planId) ?? plans[0];
  return <AttackProfit plan={plan} planId={planId} />;
}

type AttackProfitProps = {
  plan: StoredPlan;
  planId: PlanSlotId;
};

function AttackProfit({ plan, planId }: AttackProfitProps) {
  const [draft, setDraft] = useStoredState(STORAGE_KEY, loadDraft);

  const now = useNow();
  const today = localDateKey(now);
  const cfg = useMemo(() => configFromPlan(plan, today), [plan, today]);
  const ticksSinceStart = computeCurrentTick(cfg, now);
  const currentTick = Math.max(0, ticksSinceStart);
  const perDay = ticksPerDay(cfg);
  const gainTicks = useMemo(() => GAIN_DAYS.map((day) => dayToTick(day, perDay)), [perDay]);
  const manualTaxes = draft.manualTaxes;
  const taxes = useMemo<TaxSegment[]>(
    () => (manualTaxes ? [{ fromTick: 0, met: parsePercent(manualTaxes.met), kris: parsePercent(manualTaxes.kris) }] : cfg.taxes),
    [manualTaxes, cfg.taxes]
  );

  const results = useMemo(() => {
    const horizon = Math.round(HORIZON_DAYS * perDay);
    return draft.rows.map((row) =>
      calculateAttackProfit(
        currentTick,
        taxes,
        { capturedExtractors: parseAmount(row.capturedExtractors), costPerExtractor: parseAmount(row.costPerExtractor) },
        gainTicks,
        horizon
      )
    );
  }, [currentTick, taxes, draft.rows, perDay, gainTicks]);

  const tax = taxRatesAt(taxes, currentTick + 1);

  const pasteText = draft.pasteText;
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const pastedCount = draft.rows.filter((row) => row.fromPaste).length;

  function updatePasteText(text: string) {
    setDraft((prev) => ({ ...prev, pasteText: text, rows: syncPastedRows(prev.rows, parseAttackCalculations(text)) }));
  }

  /** Jede eingefügte Kopie kommt in eigene Zeilen, damit direkt die nächste dahinter eingefügt werden kann. */
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (pasted === "") return;
    event.preventDefault();
    const el = event.currentTarget;
    const before = pasteText.slice(0, el.selectionStart);
    const after = pasteText.slice(el.selectionEnd);
    const separator = before.trim() === "" || before.endsWith("\n") ? "" : "\n";
    const insert = `${separator}${pasted}\n`;
    const cursor = before.length + insert.length;
    updatePasteText(before + insert + after);
    requestAnimationFrame(() => {
      pasteRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function updateRow(id: string, patch: Partial<AttackRow>) {
    setDraft((prev) => ({ ...prev, rows: prev.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) }));
  }

  function removeRow(id: string) {
    setDraft((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.id !== id) }));
  }

  function updateManualTaxes(patch: Partial<ManualTaxes>) {
    setDraft((prev) => (prev.manualTaxes ? { ...prev, manualTaxes: { ...prev.manualTaxes, ...patch } } : prev));
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="flex flex-col gap-6 px-6 py-8 max-md:px-4 max-md:py-6">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Lohnt sich der Angriff?</h1>

        <div className="grid gap-6 md:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Steuern</CardTitle>
              <CardDescription>
                {manualTaxes
                  ? "Manuell gesetzt, gelten für den ganzen Zeitraum."
                  : `Aus dem aktiven Plan (${planSlotLabel(planId)}), Stand Tick ${currentTick} (${clockLabel(cfg, currentTick)}).`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end justify-between gap-4">
              {manualTaxes ? (
                <div className="grid w-72 grid-cols-2 gap-2">
                  <Field>
                    <FieldLabel>Steuer Met</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        type="number"
                        min={0}
                        max={100}
                        inputMode="decimal"
                        aria-label="Steuer auf Metall"
                        className="tabular-nums"
                        value={manualTaxes.met}
                        onChange={(e) => updateManualTaxes({ met: e.target.value })}
                      />
                      <InputGroupAddon align="inline-end">%</InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Field>
                    <FieldLabel>Steuer Kris</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        type="number"
                        min={0}
                        max={100}
                        inputMode="decimal"
                        aria-label="Steuer auf Kristall"
                        className="tabular-nums"
                        value={manualTaxes.kris}
                        onChange={(e) => updateManualTaxes({ kris: e.target.value })}
                      />
                      <InputGroupAddon align="inline-end">%</InputGroupAddon>
                    </InputGroup>
                  </Field>
                </div>
              ) : (
                <Stat
                  label="Steuern"
                  value={`${tax.met} % / ${tax.kris} %`}
                  hint={cfg.taxes.length === 0 ? "Im Plan sind keine Steuern gesetzt" : "Met / Kris, ab nächstem Tick"}
                />
              )}
              <Button
                type="button"
                variant="outline"
                className="ml-auto max-md:ml-0"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    // Beim Umschalten starten die manuellen Steuern mit den aktuellen aus dem Plan.
                    manualTaxes: prev.manualTaxes ? null : { met: String(tax.met), kris: String(tax.kris) },
                  }))
                }
              >
                <ArrowRightLeft data-icon="inline-start" />
                {manualTaxes ? "Steuern aus Plan" : "Steuern manuell setzen"}
              </Button>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Angriffsberechnung einfügen</CardTitle>
              <CardDescription>
                Aus einer Kampfsim die Zeilen von <span className="font-medium text-foreground">„Extraktoren …“</span> oben links bis zum
                letzten Wert von <span className="font-medium text-foreground">„Geklaut von …“</span> des letzten Angreifers unten rechts
                kopieren, oder aus einem ZKB die Extraktoren-Info ab <span className="font-medium text-foreground">„Extraktoren“</span>. Es
                können mehrere Auswertungen untereinander eingefügt werden.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <Textarea
                  ref={pasteRef}
                  aria-label="Angriffsberechnung"
                  className="max-h-40 font-mono"
                  placeholder="Angriffsberechnung hier einfügen …"
                  spellCheck={false}
                  value={pasteText}
                  onChange={(e) => updatePasteText(e.target.value)}
                  onPaste={handlePaste}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Eingefügte Angriffsberechnungen löschen"
                  disabled={pasteText === ""}
                  onClick={() => updatePasteText("")}
                >
                  <Trash2 />
                </Button>
              </div>
              {pasteText.trim() === "" ? null : pastedCount === 0 ? (
                <p className="text-xs text-destructive">Keine Kampfsim und kein ZKB erkannt.</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {pastedCount} {pastedCount === 1 ? "Angriff" : "Angriffe"} aus der Angriffsberechnung.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Angriffe</CardTitle>
            <CardDescription>
              {GAIN_DAYS.map((day, i) => `Tick ${formatRes(gainTicks[i])} = ${day} Tage`).join(", ")} nach Rundenanfang.
            </CardDescription>
            <CardAction className="flex flex-col items-end gap-0.5 text-right max-md:col-start-1 max-md:row-span-1 max-md:row-start-3 max-md:items-start max-md:text-left">
              <span className="text-sm font-medium text-sky-500">
                Die Berechnung nimmt den Rundenstart am {clockLabel(cfg, 0)} an (
                {ticksSinceStart >= 0 ? `vor ${formatRes(ticksSinceStart)} Ticks` : `in ${formatRes(-ticksSinceStart)} Ticks`}).
              </span>
              <span className="text-[11px] text-muted-foreground">Dies kann in den Einstellungen geändert werden.</span>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Table containerClassName="max-md:hidden">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Ziel</TableHead>
                  <TableHead className="w-44">Angreifer</TableHead>
                  <TableHead className="w-36">Erbeutete Extraktoren</TableHead>
                  <TableHead className="w-40">Kosten pro Extraktor</TableHead>
                  <TableHead>Verlust gesamt</TableHead>
                  <TableHead>Profitabel in</TableHead>
                  {gainTicks.map((tick) => (
                    <TableHead key={tick}>Mehrgewinn bis Tick {formatRes(tick)}</TableHead>
                  ))}
                  <TableHead className="w-10">
                    <span className="sr-only">Aktion</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.rows.map((row, index) => {
                  const result = results[index] ?? null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Input
                          aria-label="Ziel"
                          className="min-w-40"
                          placeholder="Name, Koordinaten,..."
                          value={row.target}
                          onChange={(e) => updateRow(row.id, { target: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="Angreifer"
                          className="min-w-40"
                          placeholder="Name, Koordinaten,..."
                          value={row.attacker}
                          onChange={(e) => updateRow(row.id, { attacker: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <AmountInput
                          label="Erbeutete Extraktoren"
                          unit="Exen"
                          value={row.capturedExtractors}
                          onChange={(value) => updateRow(row.id, { capturedExtractors: value })}
                        />
                      </TableCell>
                      <TableCell>
                        <AmountInput
                          label="Kosten pro Extraktor"
                          unit="Res"
                          value={row.costPerExtractor}
                          onChange={(value) => updateRow(row.id, { costPerExtractor: value })}
                        />
                      </TableCell>
                      <TableCell>
                        <LossValue result={result} />
                      </TableCell>
                      <TableCell>
                        <BreakEvenValue result={result} currentTick={currentTick} cfg={cfg} perDay={perDay} />
                      </TableCell>
                      {gainTicks.map((tick, i) => (
                        <TableCell key={tick}>
                          <GainValue result={result} index={i} />
                        </TableCell>
                      ))}
                      <TableCell>
                        <Button type="button" variant="ghost" size="icon" aria-label="Angriff entfernen" onClick={() => removeRow(row.id)}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {draft.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6 + gainTicks.length + 1} className="text-center text-muted-foreground">
                      Noch kein Angriff eingetragen.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
            {/* Mobil: eine Karte pro Angriff statt der breiten Tabelle. */}
            <div className="flex flex-col gap-3 md:hidden">
              {draft.rows.map((row, index) => {
                const result = results[index] ?? null;
                return (
                  <div key={row.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                    <div className="flex items-end gap-2">
                      <div className="grid flex-1 grid-cols-2 gap-2">
                        <Field>
                          <FieldLabel>Ziel</FieldLabel>
                          <Input
                            aria-label="Ziel"
                            placeholder="Name, Koord.,..."
                            value={row.target}
                            onChange={(e) => updateRow(row.id, { target: e.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>Angreifer</FieldLabel>
                          <Input
                            aria-label="Angreifer"
                            placeholder="Name, Koord.,..."
                            value={row.attacker}
                            onChange={(e) => updateRow(row.id, { attacker: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Button type="button" variant="ghost" size="icon" aria-label="Angriff entfernen" onClick={() => removeRow(row.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field>
                        <FieldLabel>Erbeutete Extraktoren</FieldLabel>
                        <AmountInput
                          label="Erbeutete Extraktoren"
                          unit="Exen"
                          value={row.capturedExtractors}
                          onChange={(value) => updateRow(row.id, { capturedExtractors: value })}
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Kosten pro Extraktor</FieldLabel>
                        <AmountInput
                          label="Kosten pro Extraktor"
                          unit="Res"
                          value={row.costPerExtractor}
                          onChange={(value) => updateRow(row.id, { costPerExtractor: value })}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-xs">
                      <MobileValue label="Verlust gesamt">
                        <LossValue result={result} />
                      </MobileValue>
                      <MobileValue label="Profitabel in">
                        <BreakEvenValue result={result} currentTick={currentTick} cfg={cfg} perDay={perDay} />
                      </MobileValue>
                      {gainTicks.map((tick, i) => (
                        <MobileValue key={tick} label={`Mehrgewinn bis Tick ${formatRes(tick)}`}>
                          <GainValue result={result} index={i} />
                        </MobileValue>
                      ))}
                    </div>
                  </div>
                );
              })}
              {draft.rows.length === 0 ? <p className="text-center text-xs text-muted-foreground">Noch kein Angriff eingetragen.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setDraft((prev) => ({ ...prev, rows: [...prev.rows, newRow()] }))}>
                <Plus data-icon="inline-start" />
                Angriff hinzufügen
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={draft.rows.length === 0}
                onClick={() => setDraft((prev) => ({ ...prev, rows: [], pasteText: "" }))}
              >
                <Trash2 data-icon="inline-start" />
                Alle löschen
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
