import { getExtractorCost, getExtractorYield, getRequiredAsteroidAmount } from "@/lib/gn-data/extractor.ts";
import { defaults, type PlanEntry, type RoidMulti } from "@/lib/gn-data/plan.ts";
import { evaluateQuests, type QuestDef, type QuestReward } from "@/lib/gn-data/quests.ts";
import { withUnitBuildBug } from "@/lib/gn-data/build-time-bug.ts";
import { defenses as baseDefenses, type Defense } from "@/lib/gn-data/defense.ts";
import { ships as baseShips, type Ship } from "@/lib/gn-data/ships.ts";
import { techtree, type TechTreeEntry } from "@/lib/gn-data/techtree.ts";
import { utilities as baseUtilities, type Utility } from "@/lib/gn-data/utility.ts";

// Spiel-Bug: Einheiten und Scan-Items bauen 1 Tick länger (siehe build-time-bug.ts).
// Asteroiden sind sofort da und bleiben ausgenommen.
const ships = baseShips.map(withUnitBuildBug);
const defenses = baseDefenses.map(withUnitBuildBug);
const utilities = baseUtilities.map((u) => (u.name === "Asteroid" ? u : withUnitBuildBug(u)));

/** @deprecated use startCfg.tick_minutes / defaults.tick_minutes */
export const TICK_MINUTES = defaults.tick_minutes;

/** Die Simulation läuft so viele Ticks über das Spätere aus aktuellem Tick und Planende hinaus. */
export const FORECAST_TICKS = 192;

const asteroidUtility = utilities.find((u) => u.name === "Asteroid");
const ASTEROID_COST_KRIS = asteroidUtility?.cost.kris ?? 10_000;
/** Plätze pro Asteroid — abgeleitet aus getRequiredAsteroidAmount. */
const EXTRACTOR_SLOT_PER_ASTEROID = (() => {
  let n = 1;
  while (getRequiredAsteroidAmount(n) === 1) n += 1;
  return n - 1;
})();
const EXTRACTOR_INCOME_PER_UNIT = getExtractorYield(1);

/** Absolute income per completed building (not cumulative across tiers). */
const INCOME_BY_BUILDING: Record<string, { met: number; kris: number }> = {
  Koloniezentrum: { met: 500, kris: 500 },
  Kristallmine: { met: 0, kris: 1000 },
  Metallmine: { met: 1000, kris: 0 },
  "Zweite Kristallmine": { met: 0, kris: 2000 },
  "Zweite Metallmine": { met: 2000, kris: 0 },
  "Tiefe Kristallminen": { met: 0, kris: 4000 },
  "Tiefe Metallminen": { met: 4000, kris: 0 },
  "Vollautomatisierte Kristallmine": { met: 0, kris: 10000 },
  "Vollautomatisierte Metallmine": { met: 10000, kris: 0 },
};

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

/**
 * Steuer-Abschnitt: an `fromTick` gesetzt, greift ab dem Einkommen des Folgeticks (Steuern um 9:00 →
 * gelten ab 9:15) bis zum nächsten Abschnitt bzw. Planende.
 */
export type TaxSegment = {
  fromTick: number;
  /** Steuer auf Metall-Einkommen in Prozent (0–100). */
  met: number;
  /** Steuer auf Kristall-Einkommen in Prozent (0–100). */
  kris: number;
};

export type StartConfig = {
  start_time: string;
  start_date: string;
  /** Länge eines Ticks in Minuten. */
  tick_minutes: number;
  /** Simulations-Horizont / Safety-Cap in Ticks. */
  max_ticks: number;
  /** Voraussichtliches Rundenende in Ticks; hebt den Simulations-Horizont ggf. an. */
  round_end_tick: number;
  starting_resources: { metall: number; kristall: number };
  /** Steuer-Abschnitte; Tick 0 ist immer 0%/0%. */
  taxes: TaxSegment[];
  /** Quereinstieg: fehlende Voraussetzungen nur bei Gebäuden/Forschung markieren. */
  ignore_non_tech_deps?: boolean;
  plan: PlanEntry[];
};

export function normalizeTaxes(raw: unknown): TaxSegment[] {
  if (!Array.isArray(raw)) return [];
  const byTick = new Map<number, TaxSegment>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const fromTick = typeof o.fromTick === "number" && Number.isFinite(o.fromTick) ? Math.max(0, Math.floor(o.fromTick)) : NaN;
    const met = typeof o.met === "number" && Number.isFinite(o.met) ? o.met : NaN;
    const kris = typeof o.kris === "number" && Number.isFinite(o.kris) ? o.kris : NaN;
    if (!Number.isFinite(fromTick) || !Number.isFinite(met) || !Number.isFinite(kris)) continue;
    if (fromTick <= 0) continue;
    byTick.set(fromTick, {
      fromTick,
      met: Math.min(100, Math.max(0, Math.floor(met))),
      kris: Math.min(100, Math.max(0, Math.floor(kris))),
    });
  }
  return [...byTick.values()].sort((a, b) => a.fromTick - b.fromTick);
}

/** Steuersätze für das Einkommen an `tick`. Ein Abschnitt greift erst einen Tick nach `fromTick`. */
export function taxRatesAt(taxes: TaxSegment[] | undefined, tick: number): { met: number; kris: number } {
  let current = { met: 0, kris: 0 };
  if (!taxes) return current;
  for (const seg of taxes) {
    if (seg.fromTick >= tick) break;
    current = { met: seg.met, kris: seg.kris };
  }
  return current;
}

export function taxedIncome(gross: Res, taxes: TaxSegment[] | undefined, tick: number): Res {
  const tax = taxRatesAt(taxes, tick);
  return {
    met: Math.ceil((gross.met * (100 - tax.met)) / 100),
    kris: Math.ceil((gross.kris * (100 - tax.kris)) / 100),
  };
}

function projectWithIncome(start: Res, fromTick: number, toTick: number, grossIncome: Res, taxes: TaxSegment[] | undefined): Res {
  let met = start.met;
  let kris = start.kris;
  for (let t = fromTick + 1; t <= toTick; t++) {
    const net = taxedIncome(grossIncome, taxes, t);
    met += net.met;
    kris += net.kris;
  }
  return { met, kris };
}

function tickMinutesOf(startCfg: Pick<StartConfig, "tick_minutes">) {
  return startCfg.tick_minutes > 0 ? startCfg.tick_minutes : defaults.tick_minutes;
}

function maxTicksOf(startCfg: StartConfig) {
  return Math.max(startCfg.max_ticks > 0 ? startCfg.max_ticks : defaults.max_ticks, startCfg.round_end_tick);
}

export type Res = { met: number; kris: number };

export type JobKind =
  TechTreeEntry["type"] | "economy" | "unit" | "recon" | "custom" | "roid" | "catastrophe" | "attack" | "trade" | "snapshot";

export type Job = {
  name: string;
  type: JobKind;
  startTick: number;
  endTick: number;
  cost: Res;
  /** Verknüpfung zum Plan-Eintrag (für Timeline-Edit). */
  planEntryId?: string;
  /** Deps fehlen im Plan — Job wird trotzdem simuliert. */
  blocked?: boolean;
  /** Rohstoffe reichen am Start-Tick nicht; der Job wird trotzdem bezahlt und das Konto negativ. */
  underfunded?: boolean;
  /**
   * Nur Angriffsflug: Kampfphase [startTick, endTick] für die Timeline; ab `roidStartTick`
   * wird geroidet (fehlt = kein Roid).
   */
  combat?: { startTick: number; endTick: number; roidStartTick?: number };
};

export type NamedJob = {
  name: string;
  type: JobKind;
  planEntryId?: string;
  cost?: Res;
  underfunded?: boolean;
};

export type ActiveJob = NamedJob & {
  remainingTicks: number;
};

export type QuestEvent = {
  id: string;
  label: string;
  reward: QuestReward;
};

export type RoidLootEvent = {
  planEntryId: string;
  met: number;
  kris: number;
};

export type TickSnapshot = {
  tick: number;
  clockLabel: string;
  met: number;
  kris: number;
  incomeMet: number;
  incomeKris: number;
  active: ActiveJob[];
  started: NamedJob[];
  finished: NamedJob[];
  /** Quests, die in diesem Tick ausgeschüttet wurden. */
  quests: QuestEvent[];
  /** Roid-Beute in diesem Tick (kostenlose Exen). */
  roidLoot: RoidLootEvent[];
  /** Extraktorenverlust durch Katastrophe in diesem Tick. */
  catastropheLoss: RoidLootEvent[];
  asteroids: number;
  extractorsMet: number;
  extractorsKris: number;
  extractorsMetProducing: number;
  extractorsKrisProducing: number;
};

export type PlanResult = {
  goal: string;
  finishTick: number;
  steps: Job[];
  ticks: TickSnapshot[];
  finalRes: Res;
  start: StartConfig;
  asteroids: number;
  extractorsMet: number;
  extractorsKris: number;
  extractorSlots: number;
  extractorsMetProducing: number;
  extractorsKrisProducing: number;
  unslottedExtractors: number;
  /** Tatsächlicher Start-Tick je Plan-Eintrag-id. */
  entryActualStart: Record<string, number>;
  /** Fertigstellungs-Tick je Plan-Eintrag-id. */
  entryFinishTicks: Record<string, number>;
};

export type ExtractorSlotShortage = {
  extractors: number;
  slots: number;
  unslotted: number;
  asteroids: number;
  asteroidsNeeded: number;
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function byName(entries: TechTreeEntry[] = techtree): Map<string, TechTreeEntry> {
  return new Map(entries.map((e) => [e.name, e]));
}

export function getTechtree(): TechTreeEntry[] {
  return techtree;
}

export function shipByName(name: string): Ship | undefined {
  return ships.find((s) => s.name === name);
}

export function defenseByName(name: string): Defense | undefined {
  return defenses.find((d) => d.name === name);
}

export function unitByName(name: string): Ship | Defense | undefined {
  return shipByName(name) ?? defenseByName(name);
}

export function reconByName(name: string): Utility | undefined {
  return utilities.find((u) => u.name === name && u.name !== "Asteroid");
}

export function getReconItems(): Utility[] {
  return utilities.filter((u) => u.name !== "Asteroid");
}

export function getShips(): Ship[] {
  return ships;
}

export function getDefenses(): Defense[] {
  return defenses;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addRes(a: Res, b: Res): Res {
  return { met: a.met + b.met, kris: a.kris + b.kris };
}

function canAfford(res: Res, cost: Res) {
  return res.met >= cost.met && res.kris >= cost.kris;
}

function pay(res: Res, cost: Res): Res {
  return { met: res.met - cost.met, kris: res.kris - cost.kris };
}

function requiredClosure(goal: string, map: Map<string, TechTreeEntry>) {
  const needed = new Set<string>();
  function visit(name: string) {
    if (needed.has(name)) return;
    const entry = map.get(name);
    if (!entry) throw new Error(`Unbekannte Technologie: ${name}`);
    needed.add(name);
    for (const dep of entry.dependencies) visit(dep);
  }
  visit(goal);
  return needed;
}

/** Nach dem Bezahlen: Ein Rohstoff, den der Eintrag kostet, ist ins Minus gerutscht. */
function isUnderfunded(res: Res, cost: Res) {
  return (cost.met > 0 && res.met < 0) || (cost.kris > 0 && res.kris < 0);
}

export function incomeFrom(completed: Set<string>): Res {
  let met = 0;
  let kris = 0;
  for (const name of completed) {
    const inc = INCOME_BY_BUILDING[name];
    if (!inc) continue;
    met = Math.max(met, inc.met);
    kris = Math.max(kris, inc.kris);
  }
  return { met, kris };
}

type ClockConfig = Pick<StartConfig, "start_time" | "start_date" | "tick_minutes">;

/** Lokale Start-DateTime aus plan-defaults (ohne TZ-Drift durch ISO-Parse). */
function startDateTime(startCfg: ClockConfig): Date {
  const [y, mo, d] = startCfg.start_date.split("-").map(Number);
  const [h, m] = startCfg.start_time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

/**
 * Verstrichene Ticks seit Planstart: floor((now − start) / tick_minutes).
 */
export function computeCurrentTick(startCfg: StartConfig, now: Date = new Date()): number {
  const start = startDateTime(startCfg);
  const diffMs = now.getTime() - start.getTime();
  return Math.floor(diffMs / (tickMinutesOf(startCfg) * 60 * 1000));
}

export function formatWallClock(date: Date) {
  const d = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${d}.${mo}.${y} ${hh}:${mm}`;
}

/**
 * Zeitpunkt eines Ticks. Ticks laufen in Echtzeit weiter, auch über die Zeitumstellung: Im Oktober
 * gibt es 2–3 Uhr doppelt, im April fällt die Stunde weg.
 */
function tickDateTime(startCfg: ClockConfig, tick: number): Date {
  const start = startDateTime(startCfg);
  return new Date(start.getTime() + tick * tickMinutesOf(startCfg) * 60 * 1000);
}

/** Restzeit bis zu einem Tick, z.B. "in 2 Stunden und 05 Minuten". */
export function formatTimeUntilTick(startCfg: StartConfig, tick: number, now: Date = new Date()): string {
  const target = tickDateTime(startCfg, tick);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "jetzt";

  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  }
  if (minutes === 0) {
    return `in ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  }
  return `in ${hours} ${hours === 1 ? "Stunde" : "Stunden"} und ${String(minutes).padStart(2, "0")} Minuten`;
}

/** Lokale Uhrzeit eines Ticks („TT.MM.JJJJ HH:MM“), berücksichtigt die Zeitumstellung. */
export function clockLabel(startCfg: ClockConfig, tick: number) {
  return formatWallClock(tickDateTime(startCfg, tick));
}

export function formatRes(n: number) {
  return Math.round(n).toLocaleString("de-DE");
}

export function extractorUnitCost(index1Based: number): number {
  return getExtractorCost(index1Based);
}

/** Gesamtkosten der ersten n Extraktoren (65+130+…+n*65). */
export function totalExtractorCost(count: number): number {
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = 1; i <= count; i++) sum += getExtractorCost(i);
  return sum;
}

/**
 * Kosten für `count` weitere Extraktoren, wenn bereits `alreadyBuilt` stehen.
 * Index ist 1-basiert: nächster kostet (alreadyBuilt+1)*65.
 */
export function extractorBatchCost(alreadyBuilt: number, count: number): number {
  if (count <= 0) return 0;
  let sum = 0;
  const base = Math.max(0, alreadyBuilt);
  for (let i = 1; i <= count; i++) sum += getExtractorCost(base + i);
  return sum;
}

export function newPlanEntryId(prefix = "plan"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** @deprecated use newPlanEntryId */
export function newEconomyOrderId(): string {
  return newPlanEntryId("eco");
}

function formatExtractorLabel(resource: "met" | "kris", count: number): string {
  if (resource === "met") {
    return count === 1 ? "1 Metallextraktor" : `${count} Metallextraktoren`;
  }
  return count === 1 ? "1 Kristallextraktor" : `${count} Kristallextraktoren`;
}

function formatAsteroidLabel(count: number): string {
  return count === 1 ? "1 Asteroid scannen" : `${count} Asteroiden scannen`;
}

export function formatPlanEntryLabel(entry: PlanEntry): string {
  switch (entry.kind) {
    case "tech":
      return entry.name;
    case "unit":
      return entry.count === 1 ? entry.name : `${entry.count}× ${entry.name}`;
    case "recon":
      return entry.count === 1 ? entry.name : `${entry.count}× ${entry.name}`;
    case "economy": {
      const parts: string[] = [];
      if (entry.asteroids > 0) parts.push(formatAsteroidLabel(entry.asteroids));
      if (entry.extractorsMet > 0) {
        parts.push(formatExtractorLabel("met", entry.extractorsMet));
      }
      if (entry.extractorsKris > 0) {
        parts.push(formatExtractorLabel("kris", entry.extractorsKris));
      }
      return parts.join(" + ") || "Economy";
    }
    case "extractors":
      return formatExtractorLabel(entry.resource, entry.count);
    case "asteroids":
      return formatAsteroidLabel(entry.count);
    case "custom":
      return entry.label.trim() || "Custom";
    case "trade":
      return formatTradePlanLabel(entry.give, entry.giveAmount, entry.receiveAmount);
    case "roid":
      return formatRoidPlanLabel(entry.targetMet, entry.targetKris);
    case "catastrophe":
      return formatCatastrophePlanLabel(entry.duration);
    case "attack":
      return formatAttackPlanLabel(entry);
    case "snapshot":
      return formatSnapshotPlanLabel(entry);
  }
}

export function formatTradePlanLabel(give: "met" | "kris", giveAmount: number, receiveAmount: number) {
  const from = give === "met" ? "M" : "K";
  const to = give === "met" ? "K" : "M";
  return `Trade ${formatRes(giveAmount)}${from} → ${formatRes(receiveAmount)}${to}`;
}

export const ROID_STEAL_RATE = 0.1;
export const ROID_DURATION_MIN = 1;
export const ROID_DURATION_MAX = 10;
export const CATASTROPHE_DURATION_MIN = 1;
export const CATASTROPHE_DURATION_MAX = 25;
/** Hin- bzw. Rückflug eines Angriffs in Ticks. */
export const ATTACK_FLIGHT_TICKS = 30;
export const ATTACK_DURATION_MIN = 1;
export const ATTACK_DURATION_MAX = 10;

export function clampAttackDuration(n: number): number {
  if (!Number.isFinite(n)) return ATTACK_DURATION_MIN;
  return Math.min(ATTACK_DURATION_MAX, Math.max(ATTACK_DURATION_MIN, Math.floor(n)));
}

/**
 * Erster Kampftick: der Tick nach der Ankunft. Abflug 08:00 → Ankunft 15:30 (+30) →
 * erster Kampf 15:45 (+31); letzter Kampftick +30+Dauer, Rückkehr +60+Dauer.
 */
export function attackFirstCombatTick(startTick: number): number {
  return startTick + ATTACK_FLIGHT_TICKS + 1;
}

/** Roid-Ticks eines Angriffs: 1 bis Kampfdauer, ohne Angabe der ganze Kampf. */
export function clampAttackRoidDuration(roidDuration: number | undefined, duration: number) {
  const d = clampAttackDuration(duration);
  if (roidDuration === undefined || !Number.isFinite(roidDuration)) return d;
  return Math.min(d, Math.max(1, Math.floor(roidDuration)));
}

/** Erster Roid-Tick: der Roid liegt immer auf den letzten Kampfticks. */
export function attackRoidStartTick(startTick: number, duration: number, roidDuration: number | undefined): number {
  return attackFirstCombatTick(startTick) + clampAttackDuration(duration) - clampAttackRoidDuration(roidDuration, duration);
}

/** Gesamtdauer eines Angriffsflugs: Hinflug + Kampf (+ Rückflug). */
export function attackTotalTicks(duration: number, noReturn = false): number {
  return (noReturn ? 1 : 2) * ATTACK_FLIGHT_TICKS + clampAttackDuration(duration);
}

export function formatAttackPlanLabel(entry: { duration: number; targetMet: number; targetKris: number }): string {
  const d = clampAttackDuration(entry.duration);
  return entry.targetMet > 0 || entry.targetKris > 0
    ? `Angriffsflug ${entry.targetMet}/${entry.targetKris} · ${d} T`
    : `Angriffsflug ${d} T`;
}

export function clampRoidDuration(n: number): number {
  if (!Number.isFinite(n)) return ROID_DURATION_MIN;
  return Math.min(ROID_DURATION_MAX, Math.max(ROID_DURATION_MIN, Math.floor(n)));
}

export function clampCatastropheDuration(n: number): number {
  if (!Number.isFinite(n)) return CATASTROPHE_DURATION_MIN;
  return Math.min(CATASTROPHE_DURATION_MAX, Math.max(CATASTROPHE_DURATION_MIN, Math.floor(n)));
}

export function formatRoidPlanLabel(targetMet: number, targetKris: number): string {
  return `Roid ${targetMet}/${targetKris}`;
}

export function formatCatastrophePlanLabel(duration: number): string {
  return `Katastrophe ${clampCatastropheDuration(duration)} T`;
}

export function formatRoidLootLabel(loot: { met: number; kris: number }): string {
  const parts: string[] = [];
  if (loot.met > 0) parts.push(`+${loot.met} M-Exen`);
  if (loot.kris > 0) parts.push(`+${loot.kris} K-Exen`);
  return parts.join(", ");
}

export function formatCatastropheLossLabel(loss: { met: number; kris: number }): string {
  const parts: string[] = [];
  if (loss.met > 0) parts.push(`−${loss.met} M-Exen`);
  if (loss.kris > 0) parts.push(`−${loss.kris} K-Exen`);
  return parts.join(", ");
}

export function formatSnapshotPlanLabel(entry: {
  met: number;
  kris: number;
  extractorsMet: number;
  extractorsKris: number;
  asteroids: number;
}): string {
  return `Stand ${formatRes(entry.met)} M · ${formatRes(entry.kris)} K · ${entry.extractorsMet}/${entry.extractorsKris} Ex · ${entry.asteroids} Ast`;
}

export function roidEndTick(startTick: number, duration: number): number {
  return startTick + clampRoidDuration(duration);
}

export function roidsOverlap(aStart: number, aDuration: number, bStart: number, bDuration: number): boolean {
  return aStart < roidEndTick(bStart, bDuration) && bStart < roidEndTick(aStart, aDuration);
}

export function findOverlappingRoid(
  plan: PlanEntry[],
  startTick: number,
  duration: number,
  exceptId?: string
): Extract<PlanEntry, { kind: "roid" }> | undefined {
  return plan.find(
    (e): e is Extract<PlanEntry, { kind: "roid" }> =>
      e.kind === "roid" && e.id !== exceptId && roidsOverlap(startTick, duration, e.startTick, e.duration)
  );
}

/** Bereinigt die Mehrfach-Angreifer-Daten (z. B. aus localStorage/Import). */
export function normalizeRoidMulti(raw: unknown): RoidMulti | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as { ownCleptors?: unknown; attackers?: unknown };
  function int(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
    return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : min;
  }
  const attackers = Array.isArray(o.attackers)
    ? o.attackers
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({
          startOffset: int(a.startOffset, 0, ROID_DURATION_MAX - 1),
          duration: int(a.duration, ROID_DURATION_MIN, ROID_DURATION_MAX),
          cleptors: int(a.cleptors, 0),
        }))
    : [];
  return { ownCleptors: int(o.ownCleptors, 0), attackers };
}

export type RoidLootPlan = {
  /** Eigene Beute pro eigenem Angriffs-Tick. */
  perTick: { met: number; kris: number }[];
  own: { met: number; kris: number };
  /** Beute aller Angreifer zusammen. */
  total: { met: number; kris: number };
};

/**
 * Rechnet einen Roid Tick für Tick durch. Pro Tick sind 10% der restlichen Ziel-Exen
 * (abgerundet) erbeutbar. Ohne `multi` bekommen wir alles (Cleptoren unbegrenzt).
 * Mit `multi` wird die Beute nach aktiven Cleptoren aufgeteilt; jeder Cleptor, der eine
 * Exe klaut, wird zerstört. Jeder Anteil wird kaufmännisch gerundet (im Spiel verifiziert:
 * 18263 vs. 12166 Cleptoren auf 701/947 Exen) — wir zuerst, dann die anderen Angreifer in
 * Reihenfolge, bis nichts mehr übrig ist.
 */
export function computeRoidLoot(targetMet: number, targetKris: number, duration: number, multi?: RoidMulti): RoidLootPlan {
  let remMet = Math.max(0, Math.floor(targetMet));
  let remKris = Math.max(0, Math.floor(targetKris));
  const ticks = clampRoidDuration(duration);
  const perTick: { met: number; kris: number }[] = [];
  const own = { met: 0, kris: 0 };
  const total = { met: 0, kris: 0 };

  // Index 0 = wir, danach die weiteren Angreifer.
  const cleptors = multi ? [Math.max(0, multi.ownCleptors), ...multi.attackers.map((a) => Math.max(0, a.cleptors))] : [];

  for (let i = 0; i < ticks; i++) {
    const stealMet = Math.floor(remMet * ROID_STEAL_RATE);
    const stealKris = Math.floor(remKris * ROID_STEAL_RATE);

    if (!multi) {
      perTick.push({ met: stealMet, kris: stealKris });
      own.met += stealMet;
      own.kris += stealKris;
      total.met += stealMet;
      total.kris += stealKris;
      remMet -= stealMet;
      remKris -= stealKris;
      continue;
    }

    const active = cleptors.map((c, idx) => {
      if (c <= 0) return 0;
      if (idx === 0) return c;
      const a = multi.attackers[idx - 1];
      return i >= a.startOffset && i < a.startOffset + a.duration ? c : 0;
    });
    const sumCleptors = active.reduce((s, c) => s + c, 0);
    const demand = stealMet + stealKris;
    if (sumCleptors <= 0 || demand <= 0) {
      perTick.push({ met: 0, kris: 0 });
      continue;
    }

    // Zu wenige Cleptoren: Beute anteilig auf Metall/Kristall kürzen.
    let poolMet = stealMet;
    let poolKris = stealKris;
    if (demand > sumCleptors) {
      poolMet = Math.min(stealMet, Math.ceil((sumCleptors * stealMet) / demand));
      poolKris = Math.min(stealKris, sumCleptors - poolMet);
    }
    const effMet = poolMet;
    const effKris = poolKris;

    const got = active.map((c) => {
      if (c <= 0) return { met: 0, kris: 0 };
      let m = Math.min(poolMet, Math.round((effMet * c) / sumCleptors));
      let k = Math.min(poolKris, Math.round((effKris * c) / sumCleptors));
      // Jeder Cleptor klaut höchstens eine Exe.
      if (m + k > c) {
        const over = m + k - c;
        const cutKris = Math.min(k, over);
        k -= cutKris;
        m -= over - cutKris;
      }
      poolMet -= m;
      poolKris -= k;
      return { met: m, kris: k };
    });

    got.forEach((g, idx) => {
      cleptors[idx] -= g.met + g.kris;
      total.met += g.met;
      total.kris += g.kris;
    });
    remMet -= effMet - poolMet;
    remKris -= effKris - poolKris;
    perTick.push(got[0]);
    own.met += got[0].met;
    own.kris += got[0].kris;
  }

  return { perTick, own, total };
}

/**
 * Max. Extraktoren, die mit aktuellem Metall + Kristall (Asteroiden) finanzierbar sind.
 */
export function maxAffordableExtractors(opts: {
  met: number;
  kris: number;
  alreadyBuilt?: number;
  asteroids?: number;
  slots?: number;
  maxAsteroids?: number;
  /** Wenn false: keine Auto-Asteroiden-Käufe. */
  allowBuyAsteroids?: boolean;
}): number {
  let met = opts.met;
  let kris = opts.kris;
  let built = opts.alreadyBuilt ?? 0;
  let asteroids = opts.asteroids ?? 0;
  let slots = opts.slots ?? asteroids * EXTRACTOR_SLOT_PER_ASTEROID;
  const maxAsteroids = opts.maxAsteroids ?? 50;
  const allowBuy = opts.allowBuyAsteroids ?? true;

  let canBuild = 0;
  while (true) {
    while (allowBuy && built + canBuild >= slots && asteroids < maxAsteroids && kris >= ASTEROID_COST_KRIS) {
      kris -= ASTEROID_COST_KRIS;
      asteroids += 1;
      slots += EXTRACTOR_SLOT_PER_ASTEROID;
    }
    if (built + canBuild >= slots) break;
    const cost = extractorUnitCost(built + canBuild + 1);
    if (met < cost) break;
    met -= cost;
    canBuild += 1;
  }
  return canBuild;
}

function slottedExtractorStats(
  queue: Array<"met" | "kris">,
  slots: number
): {
  income: Res;
  producingMet: number;
  producingKris: number;
  unslotted: number;
} {
  let producingMet = 0;
  let producingKris = 0;
  const cap = Math.max(0, slots);
  const producingCount = Math.min(queue.length, cap);
  for (let i = 0; i < producingCount; i++) {
    if (queue[i] === "met") producingMet += 1;
    else producingKris += 1;
  }
  return {
    income: {
      met: producingMet * EXTRACTOR_INCOME_PER_UNIT,
      kris: producingKris * EXTRACTOR_INCOME_PER_UNIT,
    },
    producingMet,
    producingKris,
    unslotted: Math.max(0, queue.length - cap),
  };
}

export function getExtractorSlotShortage(plan: PlanResult): ExtractorSlotShortage | null {
  if (plan.unslottedExtractors <= 0) return null;
  const extractors = plan.extractorsMet + plan.extractorsKris;
  const needed = getRequiredAsteroidAmount(extractors);
  return {
    extractors,
    slots: plan.extractorSlots,
    unslotted: plan.unslottedExtractors,
    asteroids: plan.asteroids,
    asteroidsNeeded: Math.max(0, needed - plan.asteroids),
  };
}

export function plannedTechNames(plan: PlanEntry[]): string[] {
  return plan.filter((e): e is Extract<PlanEntry, { kind: "tech" }> => e.kind === "tech").map((e) => e.name);
}

/** Namen, die durch bereits geplante Techs via `eliminates` blockiert sind. */
export function eliminatedTechNames(owned: Iterable<string>, map: Map<string, TechTreeEntry> = byName()): Set<string> {
  const eliminated = new Set<string>();
  for (const name of owned) {
    const tech = map.get(name);
    if (!tech) continue;
    for (const n of tech.eliminates) eliminated.add(n);
  }
  return eliminated;
}

function isBlockedByElimination(tech: TechTreeEntry, eliminated: Set<string>, map: Map<string, TechTreeEntry>): boolean {
  if (eliminated.size === 0) return false;
  for (const n of requiredClosure(tech.name, map)) {
    if (eliminated.has(n)) return true;
  }
  return false;
}

/**
 * Freigeschaltete Technologien: Dependencies sind im Plan als Tech enthalten,
 * Tech selbst noch nicht im Plan, nicht durch `eliminates` blockiert.
 */
export function getUnlockedTechs(plan: PlanEntry[]): TechTreeEntry[] {
  const owned = new Set(plannedTechNames(plan));
  const map = byName();
  const eliminated = eliminatedTechNames(owned, map);
  return techtree
    .filter((e) => !owned.has(e.name))
    .filter((e) => e.dependencies.every((d) => owned.has(d)))
    .filter((e) => !isBlockedByElimination(e, eliminated, map))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

/** Alle Techs, die noch nicht im Plan stehen und nicht eliminiert sind. */
export function getAddableTechs(plan: PlanEntry[]): TechTreeEntry[] {
  const owned = new Set(plannedTechNames(plan));
  const map = byName();
  const eliminated = eliminatedTechNames(owned, map);
  return techtree
    .filter((e) => !owned.has(e.name))
    .filter((e) => !isBlockedByElimination(e, eliminated, map))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

/** Techs, die noch fehlen, damit alle Plan-Einträge erfüllbar sind. */
export function missingRequiredTechs(plan: PlanEntry[]): Set<string> {
  const map = byName();
  const owned = new Set(plannedTechNames(plan));
  const needed = new Set<string>();
  function addName(name: string) {
    if (!map.has(name)) return;
    for (const n of requiredClosure(name, map)) {
      if (!owned.has(n)) needed.add(n);
    }
  }
  for (const e of plan) {
    if (e.kind === "tech") addName(e.name);
    else if (e.kind === "unit") {
      for (const d of unitByName(e.name)?.dependencies ?? []) addName(d);
    } else if (e.kind === "recon") {
      for (const d of reconByName(e.name)?.dependencies ?? []) addName(d);
    } else if (e.kind === "economy") {
      if (e.asteroids > 0) addName("Observatorium");
      if (e.extractorsMet > 0 || e.extractorsKris > 0) addName("Extraktor");
    } else if (e.kind === "asteroids") addName("Observatorium");
    else if (e.kind === "extractors") addName("Extraktor");
    else if (e.kind === "trade") addName("Interstellarer Handel");
    else if (e.kind === "roid") {
      addName("Marineakademie");
      addName("Kaperschiff");
    }
  }
  return needed;
}

/** Schiffe, deren Tech-Dependencies im Plan stehen. */
export function getAvailableShips(plan: PlanEntry[]): Ship[] {
  const owned = new Set(plannedTechNames(plan));
  return ships.filter((s) => s.dependencies.every((d) => owned.has(d)));
}

/** Recon-Utilities (ohne Asteroid), deren Dependencies im Plan stehen. */
export function getAvailableRecon(plan: PlanEntry[]): Utility[] {
  const owned = new Set(plannedTechNames(plan));
  return getReconItems().filter((u) => u.dependencies.every((d) => owned.has(d)));
}

export function hasTechInPlan(plan: PlanEntry[], name: string): boolean {
  return plan.some((e) => e.kind === "tech" && e.name === name);
}

/** Freie Extraktor-Slots aus geplanten Asteroiden / bereits gebauten Extraktoren (sim-agnostisch grob). */
export function extractorSlotsFromAsteroids(asteroids: number): number {
  return asteroids * EXTRACTOR_SLOT_PER_ASTEROID;
}

export const ASTEROID_SLOT_CAPACITY = EXTRACTOR_SLOT_PER_ASTEROID;
export const ASTEROID_COST = { met: 0, kris: ASTEROID_COST_KRIS } as const;

/**
 * Entfernt einen Plan-Eintrag und alle Einträge, die (transitiv) von entfernten
 * Tech-Einträgen abhängen.
 */
export function removePlanEntryCascade(plan: PlanEntry[], id: string): PlanEntry[] {
  const map = byName();
  const toRemove = new Set<string>([id]);
  const removedTechNames = new Set<string>();

  const seed = plan.find((e) => e.id === id);
  if (!seed) return plan;
  if (seed.kind === "tech") removedTechNames.add(seed.name);

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of plan) {
      if (toRemove.has(entry.id)) continue;

      if (entry.kind === "tech") {
        const tech = map.get(entry.name);
        if (!tech) continue;
        const depsOnRemoved = tech.dependencies.some((d) => removedTechNames.has(d));
        // auch transitive: Closure schneidet removedTechNames
        const closure = requiredClosure(entry.name, map);
        const hits = [...removedTechNames].some((n) => n !== entry.name && closure.has(n));
        if (depsOnRemoved || hits) {
          toRemove.add(entry.id);
          removedTechNames.add(entry.name);
          changed = true;
        }
      } else if (entry.kind === "unit") {
        const unit = unitByName(entry.name);
        if (unit?.dependencies.some((d) => removedTechNames.has(d))) {
          toRemove.add(entry.id);
          changed = true;
        }
      } else if (entry.kind === "recon") {
        const item = reconByName(entry.name);
        if (item?.dependencies.some((d) => removedTechNames.has(d))) {
          toRemove.add(entry.id);
          changed = true;
        }
      } else if (entry.kind === "economy") {
        const needsExt = (entry.extractorsMet > 0 || entry.extractorsKris > 0) && removedTechNames.has("Extraktor");
        const needsAst = entry.asteroids > 0 && removedTechNames.has("Observatorium");
        if (needsExt || needsAst) {
          toRemove.add(entry.id);
          changed = true;
        }
      } else if (entry.kind === "extractors") {
        if (removedTechNames.has("Extraktor")) {
          toRemove.add(entry.id);
          changed = true;
        }
      } else if (entry.kind === "asteroids") {
        if (removedTechNames.has("Observatorium")) {
          toRemove.add(entry.id);
          changed = true;
        }
      } else if (entry.kind === "trade") {
        if (removedTechNames.has("Interstellarer Handel")) {
          toRemove.add(entry.id);
          changed = true;
        }
      }
    }
  }

  return plan.filter((e) => !toRemove.has(e.id));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

type PendingUnit = {
  entryId: string;
  name: string;
  type: "unit" | "recon";
  duration: number;
  unitCost: Res;
  remaining: number;
  desiredTick: number;
};

type PendingEconomy = {
  entryId: string;
  remainingAsteroids: number;
  remainingExtractorsMet: number;
  remainingExtractorsKris: number;
  desiredTick: number;
};

type PendingCustom = {
  entryId: string;
  label: string;
  cost: Res;
  desiredTick: number;
  done: boolean;
};

type PendingTrade = {
  entryId: string;
  give: "met" | "kris";
  giveAmount: number;
  receiveAmount: number;
  desiredTick: number;
  done: boolean;
};

type PendingRoid = {
  entryId: string;
  targetMet: number;
  targetKris: number;
  /** Eigene Beute pro Angriffs-Tick. */
  loot: { met: number; kris: number }[];
  desiredTick: number;
  duration: number;
  ticksDone: number;
};

type PendingCatastrophe = {
  entryId: string;
  desiredTick: number;
  duration: number;
  ticksDone: number;
};

type PendingSnapshot = {
  entryId: string;
  desiredTick: number;
  met: number;
  kris: number;
  extractorsMet: number;
  extractorsKris: number;
  asteroids: number;
  done: boolean;
};

function removeQueuedExtractors(queue: Array<"met" | "kris">, resource: "met" | "kris", count: number) {
  let left = count;
  for (let i = queue.length - 1; i >= 0 && left > 0; i--) {
    if (queue[i] === resource) {
      queue.splice(i, 1);
      left -= 1;
    }
  }
}

/**
 * Wie Einträge starten:
 * - `fixed`: genau am `startTick`. Fehlende Rohstoffe werden trotzdem bezahlt, das Konto wird
 *   negativ und der Job `underfunded`.
 * - `legacy`: frühestens am `startTick`, sobald die Rohstoffe reichen (Plan-Version 1, nur für die Migration).
 */
type StartMode = "fixed" | "legacy";

/**
 * Plan-getriebene Simulation, Tick für Tick:
 * - Jeder Plan-Eintrag startet an seinem `startTick` (siehe `StartMode`)
 * - Gleicher Tick → Plan-Reihenfolge
 * - Unbegrenzt parallele Jobs
 */
function runSimulation(
  plan: PlanEntry[],
  map: Map<string, TechTreeEntry>,
  startCfg: StartConfig,
  currentTick: number,
  mode: StartMode
): Omit<PlanResult, "start"> {
  const legacy = mode === "legacy";
  let res: Res = {
    met: startCfg.starting_resources.metall,
    kris: startCfg.starting_resources.kristall,
  };
  const completed = new Set<string>();
  const completedAt = new Map<string, number>();
  const claimedQuests = new Set<string>();
  let active: Job[] = [];
  const steps: Job[] = [];
  const ticks: TickSnapshot[] = [];

  let asteroids = 0;
  let extractorsMet = 0;
  let extractorsKris = 0;
  let extractorSlots = 0;
  const extractorQueue: Array<"met" | "kris"> = [];
  /** Wird bei jeder Änderung an `extractorQueue` erhöht, damit `slottedStats()` neu rechnet. */
  let extractorQueueVersion = 0;
  let slottedCache: { version: number; length: number; slots: number; stats: ReturnType<typeof slottedExtractorStats> } | null = null;
  let scanverstaerker = 0;
  let firstRoidStartTick: number | null = null;
  /** Angriffsflüge, bei deren erstem Kampftick noch kein Cleptor fertig war. */
  const attackMissingCleptor = new Set<string>();
  let cancri = 0;

  const entryActualStart: Record<string, number> = {};
  const entryFinishTicks: Record<string, number> = {};
  const entryDone = new Set<string>();

  // Pending work derived from plan (insertion order preserved)
  const techEntries = plan.filter((e): e is Extract<PlanEntry, { kind: "tech" }> => e.kind === "tech");
  const completedUnits = new Set<string>();
  const pendingTechs = new Map<string, { entryId: string; desiredTick: number }>();
  for (const e of techEntries) {
    if (!map.has(e.name)) throw new Error(`Unbekannte Technologie: ${e.name}`);
    // duplicate tech names: only first counts as build target; later ignored
    if (!pendingTechs.has(e.name) && !completed.has(e.name)) {
      pendingTechs.set(e.name, { entryId: e.id, desiredTick: e.startTick });
    }
  }

  const pendingUnits: PendingUnit[] = [];
  const pendingEconomy: PendingEconomy[] = [];
  const pendingCustom: PendingCustom[] = [];
  const pendingTrades: PendingTrade[] = [];
  const pendingRoids: PendingRoid[] = [];
  const pendingCatastrophes: PendingCatastrophe[] = [];
  const pendingSnapshots: PendingSnapshot[] = [];

  for (const e of plan) {
    if (e.kind === "unit") {
      const unit = unitByName(e.name);
      if (!unit) throw new Error(`Unbekannte Einheit: ${e.name}`);
      pendingUnits.push({
        entryId: e.id,
        name: e.name,
        type: "unit",
        duration: unit.ticks,
        unitCost: { met: unit.cost.met, kris: unit.cost.kris },
        remaining: Math.max(1, e.count),
        desiredTick: e.startTick,
      });
    } else if (e.kind === "recon") {
      const item = reconByName(e.name);
      if (!item) throw new Error(`Unbekanntes Recon-Item: ${e.name}`);
      pendingUnits.push({
        entryId: e.id,
        name: e.name,
        type: "recon",
        duration: item.ticks,
        unitCost: { met: item.cost.met, kris: item.cost.kris },
        remaining: Math.max(1, e.count),
        desiredTick: e.startTick,
      });
    } else if (e.kind === "economy") {
      const asteroids = Math.max(0, e.asteroids);
      const extractorsMet = Math.max(0, e.extractorsMet);
      const extractorsKris = Math.max(0, e.extractorsKris);
      if (asteroids <= 0 && extractorsMet <= 0 && extractorsKris <= 0) continue;
      pendingEconomy.push({
        entryId: e.id,
        remainingAsteroids: asteroids,
        remainingExtractorsMet: extractorsMet,
        remainingExtractorsKris: extractorsKris,
        desiredTick: e.startTick,
      });
    } else if (e.kind === "extractors") {
      // legacy
      pendingEconomy.push({
        entryId: e.id,
        remainingAsteroids: 0,
        remainingExtractorsMet: e.resource === "met" ? Math.max(1, e.count) : 0,
        remainingExtractorsKris: e.resource === "kris" ? Math.max(1, e.count) : 0,
        desiredTick: e.startTick,
      });
    } else if (e.kind === "asteroids") {
      // legacy
      pendingEconomy.push({
        entryId: e.id,
        remainingAsteroids: Math.max(1, e.count),
        remainingExtractorsMet: 0,
        remainingExtractorsKris: 0,
        desiredTick: e.startTick,
      });
    } else if (e.kind === "custom") {
      pendingCustom.push({
        entryId: e.id,
        label: e.label.trim() || "Custom",
        cost: {
          met: Math.max(0, e.cost.met),
          kris: Math.max(0, e.cost.kris),
        },
        desiredTick: e.startTick,
        done: false,
      });
    } else if (e.kind === "trade") {
      const giveAmount = Math.max(0, Math.floor(e.giveAmount));
      const receiveAmount = Math.max(0, Math.floor(e.receiveAmount));
      if (giveAmount <= 0 && receiveAmount <= 0) continue;
      pendingTrades.push({
        entryId: e.id,
        give: e.give === "kris" ? "kris" : "met",
        giveAmount,
        receiveAmount,
        desiredTick: e.startTick,
        done: false,
      });
    } else if (e.kind === "roid") {
      const targetMet = Math.max(0, Math.floor(e.targetMet));
      const targetKris = Math.max(0, Math.floor(e.targetKris));
      pendingRoids.push({
        entryId: e.id,
        targetMet,
        targetKris,
        loot: computeRoidLoot(targetMet, targetKris, e.duration, e.multi).perTick,
        desiredTick: e.startTick,
        duration: clampRoidDuration(e.duration),
        ticksDone: 0,
      });
    } else if (e.kind === "attack") {
      // Angriff ohne Ziel-Exen beeinflusst die Simulation nicht.
      const targetMet = Math.max(0, Math.floor(e.targetMet));
      const targetKris = Math.max(0, Math.floor(e.targetKris));
      if (targetMet <= 0 && targetKris <= 0) continue;
      const roidDuration = clampAttackRoidDuration(e.roidDuration, e.duration);
      pendingRoids.push({
        entryId: e.id,
        targetMet,
        targetKris,
        loot: computeRoidLoot(targetMet, targetKris, roidDuration, e.multi).perTick,
        desiredTick: attackRoidStartTick(e.startTick, e.duration, e.roidDuration),
        duration: roidDuration,
        ticksDone: 0,
      });
    } else if (e.kind === "catastrophe") {
      pendingCatastrophes.push({
        entryId: e.id,
        desiredTick: e.startTick,
        duration: clampCatastropheDuration(e.duration),
        ticksDone: 0,
      });
    } else if (e.kind === "snapshot") {
      pendingSnapshots.push({
        entryId: e.id,
        desiredTick: e.startTick,
        met: Math.max(0, Math.floor(e.met)),
        kris: Math.max(0, Math.floor(e.kris)),
        extractorsMet: Math.max(0, Math.floor(e.extractorsMet)),
        extractorsKris: Math.max(0, Math.floor(e.extractorsKris)),
        asteroids: Math.max(0, Math.floor(e.asteroids)),
        done: false,
      });
    }
  }

  // Schneller Zugriff auf Pending-Einträge; bei doppelten IDs gilt wie bei `.find()` der erste.
  function indexByEntryId<T extends { entryId: string }>(items: T[]): Map<string, T> {
    const index = new Map<string, T>();
    for (const item of items) if (!index.has(item.entryId)) index.set(item.entryId, item);
    return index;
  }
  const pendingUnitById = indexByEntryId(pendingUnits);
  const pendingEconomyById = indexByEntryId(pendingEconomy);
  const pendingCustomById = indexByEntryId(pendingCustom);
  const pendingTradeById = indexByEntryId(pendingTrades);
  const pendingRoidById = indexByEntryId(pendingRoids);
  const pendingCatastropheById = indexByEntryId(pendingCatastrophes);

  /** Eintrag hat in `tryStart` nichts mehr zu tun (und bekommt auch nie wieder etwas). */
  function isEntryClosed(entry: PlanEntry): boolean {
    switch (entry.kind) {
      case "tech":
        return pendingTechs.get(entry.name)?.entryId !== entry.id;
      case "unit":
      case "recon": {
        const pending = pendingUnitById.get(entry.id);
        return !pending || pending.remaining <= 0;
      }
      case "economy":
      case "asteroids":
      case "extractors": {
        const pending = pendingEconomyById.get(entry.id);
        return !pending || (pending.remainingAsteroids <= 0 && pending.remainingExtractorsMet <= 0 && pending.remainingExtractorsKris <= 0);
      }
      case "trade": {
        const pending = pendingTradeById.get(entry.id);
        return !pending || pending.done;
      }
      case "custom": {
        const pending = pendingCustomById.get(entry.id);
        return !pending || pending.done;
      }
      case "roid":
      case "attack": {
        const pending = pendingRoidById.get(entry.id);
        return !pending || pending.ticksDone >= pending.duration;
      }
      case "catastrophe": {
        const pending = pendingCatastropheById.get(entry.id);
        return !pending || pending.ticksDone >= pending.duration;
      }
      default:
        return true;
    }
  }

  /**
   * Noch offene Einträge, sortiert nach Wunsch-Tick (gleicher Tick → Plan-Reihenfolge).
   * Erledigte Einträge fliegen raus, damit `tryStart` nicht jeden Tick den ganzen Plan durchläuft.
   */
  const openOrder = plan
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.startTick - b.entry.startTick || a.index - b.index)
    .map(({ entry }) => entry)
    .filter((entry) => !isEntryClosed(entry));

  function totalExtractors() {
    return extractorsMet + extractorsKris;
  }

  /** `slottedExtractorStats` für den aktuellen Stand, gecacht bis sich Queue oder Slots ändern. */
  function slottedStats() {
    if (
      slottedCache === null ||
      slottedCache.version !== extractorQueueVersion ||
      slottedCache.length !== extractorQueue.length ||
      slottedCache.slots !== extractorSlots
    ) {
      slottedCache = {
        version: extractorQueueVersion,
        length: extractorQueue.length,
        slots: extractorSlots,
        stats: slottedExtractorStats(extractorQueue, extractorSlots),
      };
    }
    return slottedCache.stats;
  }

  function isReady(name: string) {
    const e = map.get(name)!;
    return e.dependencies.every((d) => completed.has(d));
  }

  function allDone() {
    // Offene Einträge bedeuten immer "nicht fertig"; die Detailprüfung bleibt für den Rest.
    if (openOrder.length > 0) return false;
    if (pendingTechs.size > 0) return false;
    if (pendingUnits.some((u) => u.remaining > 0)) return false;
    if (pendingEconomy.some((u) => u.remainingAsteroids > 0 || u.remainingExtractorsMet > 0 || u.remainingExtractorsKris > 0)) {
      return false;
    }
    if (pendingCustom.some((c) => !c.done)) return false;
    if (pendingTrades.some((c) => !c.done)) return false;
    if (pendingRoids.some((r) => r.ticksDone < r.duration)) return false;
    if (pendingCatastrophes.some((r) => r.ticksDone < r.duration)) return false;
    if (pendingSnapshots.some((s) => !s.done)) return false;
    // active tech/unit jobs still running → wait
    if (active.length > 0) return false;
    return true;
  }

  function markEntryStart(id: string, tick: number) {
    if (entryActualStart[id] === undefined) entryActualStart[id] = tick;
  }

  function markEntryFinish(id: string, tick: number) {
    entryFinishTicks[id] = tick;
    entryDone.add(id);
  }

  function applyManualSnapshots(tick: number): NamedJob[] {
    const started: NamedJob[] = [];
    for (const pending of pendingSnapshots) {
      if (pending.done || pending.desiredTick !== tick) continue;
      res = { met: pending.met, kris: pending.kris };
      extractorsMet = pending.extractorsMet;
      extractorsKris = pending.extractorsKris;
      asteroids = pending.asteroids;
      extractorSlots = asteroids * EXTRACTOR_SLOT_PER_ASTEROID;
      extractorQueue.length = 0;
      for (let i = 0; i < extractorsMet; i++) extractorQueue.push("met");
      for (let i = 0; i < extractorsKris; i++) extractorQueue.push("kris");
      extractorQueueVersion += 1;
      const name = formatSnapshotPlanLabel(pending);
      const job: Job = {
        name,
        type: "snapshot",
        startTick: tick,
        endTick: tick,
        cost: { met: 0, kris: 0 },
        planEntryId: pending.entryId,
      };
      steps.push(job);
      started.push({ name, type: "snapshot", planEntryId: pending.entryId });
      markEntryStart(pending.entryId, tick);
      markEntryFinish(pending.entryId, tick);
      pending.done = true;
    }
    return started;
  }

  /** Ob ein Eintrag mit diesen Kosten jetzt starten darf. Nur `legacy` wartet auf Rohstoffe. */
  function mayStart(cost: Res) {
    return !legacy || canAfford(res, cost);
  }

  function tryStart(tick: number) {
    const startedJobs: NamedJob[] = [];
    const finishedJobs: NamedJob[] = [];
    const roidLoot: RoidLootEvent[] = [];
    const catastropheLoss: RoidLootEvent[] = [];
    let spent: Res = { met: 0, kris: 0 };

    /** Kauft die Asteroiden und baut die Exen eines Wirtschafts-Eintrags, soweit möglich. */
    function startEconomy(entry: PlanEntry, pending: PendingEconomy) {
      let didWork = false;

      // Asteroids first so slots open for extractors in the same entry/tick.
      if (pending.remainingAsteroids > 0) {
        while (pending.remainingAsteroids > 0 && mayStart({ met: 0, kris: ASTEROID_COST_KRIS })) {
          const cost = { met: 0, kris: ASTEROID_COST_KRIS };
          res = pay(res, cost);
          spent = addRes(spent, cost);
          asteroids += 1;
          extractorSlots += EXTRACTOR_SLOT_PER_ASTEROID;
          pending.remainingAsteroids -= 1;
          didWork = true;
          const name = `Asteroid scannen #${asteroids}`;
          const job: Job = {
            name,
            type: "economy",
            startTick: tick,
            endTick: tick,
            cost,
            planEntryId: entry.id,
            blocked: !completed.has("Observatorium"),
            underfunded: isUnderfunded(res, cost),
          };
          steps.push(job);
          startedJobs.push({ name, type: "economy", planEntryId: entry.id, underfunded: job.underfunded });
          finishedJobs.push({ name, type: "economy", planEntryId: entry.id });
          markEntryStart(entry.id, tick);
        }
      }

      function buildExtractors(economy: PendingEconomy, resource: "met" | "kris") {
        const remainingKey = resource === "met" ? "remainingExtractorsMet" : "remainingExtractorsKris";
        while (economy[remainingKey] > 0) {
          const nextIndex = totalExtractors() + 1;
          const cost = { met: extractorUnitCost(nextIndex), kris: 0 };
          // Exen gehen nie ins Minus: Was am Tick nicht bezahlbar ist, wird in den Folgeticks gebaut.
          if (!canAfford(res, cost)) break;
          res = pay(res, cost);
          spent = addRes(spent, cost);
          if (resource === "met") extractorsMet += 1;
          else extractorsKris += 1;
          extractorQueue.push(resource);
          extractorQueueVersion += 1;
          economy[remainingKey] -= 1;
          didWork = true;
          const label = resource === "met" ? `Extraktor (Metall) #${extractorsMet}` : `Extraktor (Kristall) #${extractorsKris}`;
          const job: Job = {
            name: label,
            type: "economy",
            startTick: tick,
            endTick: tick,
            cost,
            planEntryId: entry.id,
            blocked: !completed.has("Extraktor"),
          };
          steps.push(job);
          startedJobs.push({ name: label, type: "economy", planEntryId: entry.id });
          finishedJobs.push({ name: label, type: "economy", planEntryId: entry.id });
          markEntryStart(entry.id, tick);
        }
      }
      buildExtractors(pending, "met");
      buildExtractors(pending, "kris");

      if (didWork && pending.remainingAsteroids <= 0 && pending.remainingExtractorsMet <= 0 && pending.remainingExtractorsKris <= 0) {
        markEntryFinish(entry.id, tick);
      }
    }

    const carriedEconomy: Array<{ entry: PlanEntry; pending: PendingEconomy }> = [];

    // Earlier desired startTick first; same tick keeps plan order.
    // Kein Eintrag startet vor seinem startTick (alle Wunsch-Ticks sind ≥ startTick),
    // daher reicht es, die bereits fälligen Einträge vorne in `openOrder` zu prüfen.
    let due = 0;
    for (const entry of openOrder) {
      if (entry.startTick > tick) break;
      due += 1;
      if (entry.kind === "tech") {
        const pending = pendingTechs.get(entry.name);
        if (!pending || pending.entryId !== entry.id) continue;
        if (tick < pending.desiredTick) continue;
        if (completed.has(entry.name)) {
          pendingTechs.delete(entry.name);
          continue;
        }
        if (active.some((j) => j.name === entry.name)) continue;
        const tech = map.get(entry.name)!;
        const cost = { met: tech.cost.met, kris: tech.cost.kris };
        if (!mayStart(cost)) continue;

        res = pay(res, cost);
        spent = addRes(spent, cost);
        const job: Job = {
          name: entry.name,
          type: tech.type,
          startTick: tick,
          endTick: tick + tech.ticks,
          cost,
          planEntryId: entry.id,
          blocked: !isReady(entry.name),
          underfunded: isUnderfunded(res, cost),
        };
        active.push(job);
        steps.push(job);
        startedJobs.push({
          name: entry.name,
          type: tech.type,
          planEntryId: entry.id,
          underfunded: job.underfunded,
        });
        markEntryStart(entry.id, tick);
        pendingTechs.delete(entry.name);
        continue;
      }

      if (entry.kind === "unit" || entry.kind === "recon") {
        const pending = pendingUnitById.get(entry.id);
        if (!pending || pending.remaining <= 0) continue;
        if (tick < pending.desiredTick) continue;

        // deps: for units/recon check tech deps completed
        const deps = entry.kind === "unit" ? (unitByName(entry.name)?.dependencies ?? []) : (reconByName(entry.name)?.dependencies ?? []);

        const count = pending.remaining;
        const totalCost = {
          met: pending.unitCost.met * count,
          kris: pending.unitCost.kris * count,
        };
        if (!mayStart(totalCost)) continue;

        res = pay(res, totalCost);
        spent = addRes(spent, totalCost);
        pending.remaining = 0;

        const label = count === 1 ? `1 ${entry.name} bauen` : `${count} ${entry.name} bauen`;
        const duration = pending.duration;
        const job: Job = {
          name: label,
          type: pending.type,
          startTick: tick,
          endTick: tick + duration,
          cost: totalCost,
          planEntryId: entry.id,
          blocked: deps.some((d) => !completed.has(d)),
          underfunded: isUnderfunded(res, totalCost),
        };
        if (duration <= 0) {
          if (pending.type === "unit") completedUnits.add(pending.name);
          steps.push(job);
          startedJobs.push({
            name: label,
            type: pending.type,
            planEntryId: entry.id,
            underfunded: job.underfunded,
          });
          finishedJobs.push({
            name: label,
            type: pending.type,
            planEntryId: entry.id,
            underfunded: job.underfunded,
          });
        } else {
          active.push(job);
          steps.push(job);
          startedJobs.push({
            name: label,
            type: pending.type,
            planEntryId: entry.id,
            underfunded: job.underfunded,
          });
        }
        markEntryStart(entry.id, tick);
        if (pending.remaining <= 0) {
          markEntryFinish(entry.id, tick + Math.max(0, duration));
        }
        continue;
      }

      if (entry.kind === "economy" || entry.kind === "asteroids" || entry.kind === "extractors") {
        const pending = pendingEconomyById.get(entry.id);
        if (!pending) continue;
        if (pending.remainingAsteroids <= 0 && pending.remainingExtractorsMet <= 0 && pending.remainingExtractorsKris <= 0) {
          continue;
        }
        if (tick < pending.desiredTick) continue;
        // Exen nehmen nur, was die anderen Einträge des Ticks übrig lassen, und ziehen sie so nicht ins Minus.
        if (!legacy) {
          carriedEconomy.push({ entry, pending });
          continue;
        }
        startEconomy(entry, pending);
        continue;
      }

      if (entry.kind === "trade") {
        const pending = pendingTradeById.get(entry.id);
        if (!pending || pending.done) continue;
        if (tick < pending.desiredTick) continue;
        const have = pending.give === "met" ? res.met : res.kris;
        if (legacy && have < pending.giveAmount) continue;

        if (pending.give === "met") {
          res = { met: res.met - pending.giveAmount, kris: res.kris + pending.receiveAmount };
        } else {
          res = { met: res.met + pending.receiveAmount, kris: res.kris - pending.giveAmount };
        }
        const cost: Res =
          pending.give === "met"
            ? { met: pending.giveAmount, kris: -pending.receiveAmount }
            : { met: -pending.receiveAmount, kris: pending.giveAmount };
        spent = addRes(spent, cost);
        const name = formatTradePlanLabel(pending.give, pending.giveAmount, pending.receiveAmount);
        const job: Job = {
          name,
          type: "trade",
          startTick: tick,
          endTick: tick,
          cost,
          planEntryId: entry.id,
          blocked: !completed.has("Interstellarer Handel"),
          underfunded: (pending.give === "met" ? res.met : res.kris) < 0,
        };
        steps.push(job);
        startedJobs.push({
          name,
          type: "trade",
          planEntryId: entry.id,
          cost,
          underfunded: job.underfunded,
        });
        finishedJobs.push({
          name,
          type: "trade",
          planEntryId: entry.id,
          cost,
          underfunded: job.underfunded,
        });
        markEntryStart(entry.id, tick);
        markEntryFinish(entry.id, tick);
        pending.done = true;
        continue;
      }

      if (entry.kind === "custom") {
        const pending = pendingCustomById.get(entry.id);
        if (!pending || pending.done) continue;
        if (tick < pending.desiredTick) continue;
        if (!mayStart(pending.cost)) continue;

        res = pay(res, pending.cost);
        spent = addRes(spent, pending.cost);
        const job: Job = {
          name: pending.label,
          type: "custom",
          startTick: tick,
          endTick: tick,
          cost: pending.cost,
          planEntryId: entry.id,
          underfunded: isUnderfunded(res, pending.cost),
        };
        steps.push(job);
        startedJobs.push({
          name: pending.label,
          type: "custom",
          planEntryId: entry.id,
          cost: pending.cost,
          underfunded: job.underfunded,
        });
        finishedJobs.push({
          name: pending.label,
          type: "custom",
          planEntryId: entry.id,
          cost: pending.cost,
        });
        markEntryStart(entry.id, tick);
        markEntryFinish(entry.id, tick);
        pending.done = true;
        continue;
      }

      if (entry.kind === "roid" || entry.kind === "attack") {
        const pending = pendingRoidById.get(entry.id);
        if (!pending || pending.ticksDone >= pending.duration) continue;
        if (tick < pending.desiredTick) continue;
        if (tick !== pending.desiredTick + pending.ticksDone) continue;

        if (pending.ticksDone === 0 && entry.kind === "attack") {
          // Balken kommt aus attackSteps(); hier nur festhalten, ob Cleptoren fehlen.
          if (!completedUnits.has("Cleptor")) attackMissingCleptor.add(entry.id);
          markEntryStart(entry.id, tick);
          if (firstRoidStartTick === null) firstRoidStartTick = tick;
        } else if (pending.ticksDone === 0) {
          steps.push({
            name: formatRoidPlanLabel(pending.targetMet, pending.targetKris),
            type: "roid",
            startTick: pending.desiredTick,
            endTick: pending.desiredTick + pending.duration,
            cost: { met: 0, kris: 0 },
            planEntryId: entry.id,
            blocked: !completed.has("Marineakademie") || !completedUnits.has("Cleptor"),
          });
          markEntryStart(entry.id, tick);
          if (firstRoidStartTick === null) firstRoidStartTick = tick;
        }

        const { met: stealMet, kris: stealKris } = pending.loot[pending.ticksDone] ?? {
          met: 0,
          kris: 0,
        };
        if (stealMet > 0) {
          extractorsMet += stealMet;
          for (let i = 0; i < stealMet; i++) extractorQueue.push("met");
          extractorQueueVersion += 1;
        }
        if (stealKris > 0) {
          extractorsKris += stealKris;
          for (let i = 0; i < stealKris; i++) extractorQueue.push("kris");
          extractorQueueVersion += 1;
        }
        if (stealMet > 0 || stealKris > 0) {
          roidLoot.push({ planEntryId: entry.id, met: stealMet, kris: stealKris });
        }

        pending.ticksDone += 1;
        if (pending.ticksDone >= pending.duration) {
          markEntryFinish(entry.id, tick);
        }
      }

      if (entry.kind === "catastrophe") {
        const pending = pendingCatastropheById.get(entry.id);
        if (!pending || pending.ticksDone >= pending.duration) continue;
        if (tick < pending.desiredTick) continue;
        if (tick !== pending.desiredTick + pending.ticksDone) continue;

        if (pending.ticksDone === 0) {
          const name = formatCatastrophePlanLabel(pending.duration);
          steps.push({
            name,
            type: "catastrophe",
            startTick: pending.desiredTick,
            endTick: pending.desiredTick + pending.duration,
            cost: { met: 0, kris: 0 },
            planEntryId: entry.id,
          });
          startedJobs.push({
            name,
            type: "catastrophe",
            planEntryId: entry.id,
          });
          markEntryStart(entry.id, tick);
        }

        const stealMet = Math.floor(extractorsMet * ROID_STEAL_RATE);
        const stealKris = Math.floor(extractorsKris * ROID_STEAL_RATE);
        if (stealMet > 0) {
          extractorsMet -= stealMet;
          removeQueuedExtractors(extractorQueue, "met", stealMet);
          extractorQueueVersion += 1;
        }
        if (stealKris > 0) {
          extractorsKris -= stealKris;
          removeQueuedExtractors(extractorQueue, "kris", stealKris);
          extractorQueueVersion += 1;
        }
        if (stealMet > 0 || stealKris > 0) {
          catastropheLoss.push({ planEntryId: entry.id, met: stealMet, kris: stealKris });
        }

        pending.ticksDone += 1;
        if (pending.ticksDone >= pending.duration) {
          markEntryFinish(entry.id, tick);
        }
      }
    }

    for (const { entry, pending } of carriedEconomy) startEconomy(entry, pending);

    // Erledigte Einträge aus dem fälligen Teil entfernen; Reihenfolge bleibt erhalten.
    if (due > 0) {
      const stillOpen = openOrder.slice(0, due).filter((entry) => !isEntryClosed(entry));
      if (stillOpen.length !== due) openOrder.splice(0, due, ...stillOpen);
    }

    return { startedJobs, finishedJobs, spent, roidLoot, catastropheLoss };
  }

  function applyQuestRewards(quests: QuestDef[]): QuestEvent[] {
    const events: QuestEvent[] = [];
    for (const q of quests) {
      claimedQuests.add(q.id);
      if (q.reward.kind === "res") {
        res = addRes(res, { met: q.reward.met, kris: q.reward.kris });
      } else if (q.reward.resource === "met") {
        extractorsMet += q.reward.count;
        for (let i = 0; i < q.reward.count; i++) extractorQueue.push("met");
        extractorQueueVersion += 1;
      } else {
        extractorsKris += q.reward.count;
        for (let i = 0; i < q.reward.count; i++) extractorQueue.push("kris");
        extractorQueueVersion += 1;
      }
      events.push({ id: q.id, label: q.label, reward: q.reward });
    }
    return events;
  }

  function noteFinishedRecon(jobs: NamedJob[]) {
    for (const j of jobs) {
      if (j.type !== "recon") continue;
      const m = /^(\d+) Scanverstärker\b/.exec(j.name);
      if (m) scanverstaerker += Number(m[1]);
    }
  }

  function noteFinishedUnits(jobs: NamedJob[]) {
    for (const j of jobs) {
      if (j.type !== "unit") continue;
      const m = /^(\d+)\s+Cancri\s+bauen/.exec(j.name);
      if (m) cancri += Number(m[1]);
    }
  }

  function claimReadyQuests(tick: number): QuestEvent[] {
    return applyQuestRewards(
      evaluateQuests(
        {
          completed,
          asteroids,
          extractorsMet,
          extractorsKris,
          scanverstaerker,
          tick,
          firstRoidStartTick,
          cancri,
        },
        claimedQuests
      )
    );
  }

  function snapshot(
    tick: number,
    started: NamedJob[],
    finished: NamedJob[],
    delta: Res,
    quests: QuestEvent[] = [],
    roidLoot: RoidLootEvent[] = [],
    catastropheLoss: RoidLootEvent[] = []
  ): TickSnapshot {
    const slotted = slottedStats();
    return {
      tick,
      clockLabel: clockLabel(startCfg, tick),
      met: res.met,
      kris: res.kris,
      incomeMet: delta.met,
      incomeKris: delta.kris,
      active: active
        .map((j) => ({
          name: j.name,
          type: j.type,
          remainingTicks: Math.max(0, j.endTick - tick),
          planEntryId: j.planEntryId,
          underfunded: j.underfunded,
        }))
        .sort((a, b) => a.remainingTicks - b.remainingTicks || a.name.localeCompare(b.name)),
      started,
      finished,
      quests,
      roidLoot,
      catastropheLoss,
      asteroids,
      extractorsMet,
      extractorsKris,
      extractorsMetProducing: slotted.producingMet,
      extractorsKrisProducing: slotted.producingKris,
    };
  }

  // Angriffsflug-Balken: keine started/finished-Events → nicht in den Tabellen.
  // Die Roid-Beute läuft über pendingRoids und erscheint wie gewohnt als Exen-Gewinn.
  function attackSteps(): Job[] {
    const academyAt = completedAt.get("Marineakademie");
    return plan.flatMap((e): Job[] => {
      if (e.kind !== "attack") return [];
      const combatEnd = e.startTick + ATTACK_FLIGHT_TICKS + clampAttackDuration(e.duration);
      const hasRoid = e.targetMet > 0 || e.targetKris > 0;
      return [
        {
          name: formatAttackPlanLabel(e),
          type: "attack",
          startTick: e.startTick,
          endTick: e.startTick + attackTotalTicks(e.duration, e.noReturn),
          cost: { met: 0, kris: 0 },
          planEntryId: e.id,
          blocked: academyAt === undefined || academyAt > e.startTick || attackMissingCleptor.has(e.id),
          // Kampfticks liegen auf (Ankunft, Ankunft + Dauer]: 08:00 ab → 15:45–16:45.
          // Roid-Teil wie die Kampfticks als (Tick − 1, Tick] gezeichnet.
          combat: {
            startTick: e.startTick + ATTACK_FLIGHT_TICKS,
            endTick: combatEnd,
            ...(hasRoid
              ? {
                  roidStartTick: attackRoidStartTick(e.startTick, e.duration, e.roidDuration) - 1,
                }
              : {}),
          },
        },
      ];
    });
  }

  function resultAt(finishTick: number) {
    const slotted = slottedStats();
    return {
      goal: techEntries.at(-1)?.name ?? (plan.length ? formatPlanEntryLabel(plan[plan.length - 1]!) : "Plan"),
      finishTick,
      steps: [...steps, ...attackSteps()],
      ticks,
      finalRes: res,
      asteroids,
      extractorsMet,
      extractorsKris,
      extractorSlots,
      extractorsMetProducing: slotted.producingMet,
      extractorsKrisProducing: slotted.producingKris,
      unslottedExtractors: slotted.unslotted,
      entryActualStart: { ...entryActualStart },
      entryFinishTicks: { ...entryFinishTicks },
    };
  }

  // Empty plan
  if (plan.length === 0) {
    ticks.push(snapshot(0, [], [], { met: 0, kris: 0 }));
    return resultAt(0);
  }

  /** Tick, an dem alle Plan-Einträge erledigt sind; danach läuft nur noch die Vorschau. */
  let doneTick: number | null = null;
  /** Letzter simulierter Tick, steht fest sobald `doneTick` bekannt ist. */
  let endTick: number | null = null;

  /** Planende (inkl. Angriffsflüge) bzw. aktueller Tick, je nachdem was später liegt, plus Vorschau. */
  function forecastEndTick(finishTick: number) {
    const attackEnds = attackSteps().map((s) => s.endTick);
    return Math.max(currentTick, finishTick, ...attackEnds) + FORECAST_TICKS;
  }

  // t = 0
  {
    const snapshotJobs = applyManualSnapshots(0);
    const { startedJobs, finishedJobs, spent, roidLoot, catastropheLoss } = tryStart(0);
    ticks.push(
      snapshot(0, [...snapshotJobs, ...startedJobs], finishedJobs, { met: -spent.met, kris: -spent.kris }, [], roidLoot, catastropheLoss)
    );
    if (allDone()) {
      doneTick = 0;
      endTick = forecastEndTick(0);
      if (endTick <= 0) return resultAt(0);
    }
  }

  const maxTicks = maxTicksOf(startCfg);
  // Nach Planende bestimmt `endTick` das Ende, auch jenseits von `maxTicks`.
  for (let t = 1; endTick !== null || t <= maxTicks; t++) {
    const finishing = active.filter((j) => j.endTick === t);
    active = active.filter((j) => j.endTick !== t);
    const finishedJobs: NamedJob[] = [];
    for (const job of finishing) {
      // techs mark completed by name; units don't add to completed tech set
      if (job.type === "building" || job.type === "research") {
        completed.add(job.name);
        completedAt.set(job.name, t);
        if (job.planEntryId) markEntryFinish(job.planEntryId, t);
      } else if (job.type === "unit" && job.planEntryId) {
        const unit = pendingUnitById.get(job.planEntryId);
        if (unit) completedUnits.add(unit.name);
        if (entryFinishTicks[job.planEntryId] === undefined) {
          const stillActive = active.some((j) => j.planEntryId === job.planEntryId);
          const stillPending = pendingUnits.some((u) => u.entryId === job.planEntryId && u.remaining > 0);
          if (!stillActive && !stillPending) markEntryFinish(job.planEntryId, t);
        }
      } else if (job.planEntryId && entryFinishTicks[job.planEntryId] === undefined) {
        // unit/recon multi: finish already marked when last started with endTick
        const stillActive = active.some((j) => j.planEntryId === job.planEntryId);
        const stillPending = pendingUnits.some((u) => u.entryId === job.planEntryId && u.remaining > 0);
        if (!stillActive && !stillPending) markEntryFinish(job.planEntryId, t);
      }
      finishedJobs.push({
        name: job.name,
        type: job.type,
        planEntryId: job.planEntryId,
      });
    }
    noteFinishedRecon(finishedJobs);
    noteFinishedUnits(finishedJobs);

    // Mines produce from the tick after finish. Koloniezentrum is the exception:
    // it already yields on the finish tick (21:30 done → 21:30 resources).
    const producing = new Set(
      [...completed].filter((n) => {
        const at = completedAt.get(n) ?? 0;
        return n === "Koloniezentrum" ? at <= t : at < t;
      })
    );
    const mineIncome = incomeFrom(producing);
    const extIncome = slottedStats().income;
    const income = taxedIncome(
      {
        met: mineIncome.met + extIncome.met,
        kris: mineIncome.kris + extIncome.kris,
      },
      startCfg.taxes,
      t
    );
    if (income.met || income.kris) {
      res = addRes(res, income);
    }

    // Resource quests fire with income (tech finishes). Economy quests
    // (asteroid + extractors) are re-checked after tryStart same tick.
    const questEventsEarly = claimReadyQuests(t);

    const snapshotJobs = applyManualSnapshots(t);
    const { startedJobs, finishedJobs: instantFinished, spent, roidLoot, catastropheLoss } = tryStart(t);
    startedJobs.unshift(...snapshotJobs);
    noteFinishedRecon(instantFinished);
    noteFinishedUnits(instantFinished);
    const allFinished = [...finishedJobs, ...instantFinished];

    // e.g. 1 Asteroid + ≥10 Met-Ext → +10 free Kris-Ext, immediate this tick.
    // Free extractors count toward total for later cost indices, but not for
    // builds already paid this tick (tryStart ran first).
    const questEventsLate = claimReadyQuests(t);
    const questEvents = [...questEventsEarly, ...questEventsLate];
    const questRes: Res = questEvents.reduce(
      (acc, q) => (q.reward.kind === "res" ? addRes(acc, { met: q.reward.met, kris: q.reward.kris }) : acc),
      { met: 0, kris: 0 }
    );

    // Nach Planende bleibt alles erledigt, die Prüfung ist dann überflüssig.
    const planDone = doneTick !== null || allDone();

    const delta: Res = {
      met: income.met + questRes.met - spent.met,
      kris: income.kris + questRes.kris - spent.kris,
    };
    ticks.push(snapshot(t, startedJobs, allFinished, delta, questEvents, roidLoot, catastropheLoss));

    // Planende merken, aber bis `endTick` weitersimulieren (Ressourcen-/Exen-Vorschau).
    if (doneTick === null && planDone) {
      doneTick = Math.max(0, ...Object.values(entryFinishTicks), ...steps.map((s) => s.endTick), t);
      endTick = forecastEndTick(doneTick);
    }
    if (doneTick !== null && endTick !== null && t >= endTick) return resultAt(doneTick);
  }

  throw new Error(`Plan nicht in ${maxTicks} Ticks abgeschlossen`);
}

type PlanOutcome = { ok: true; result: PlanResult } | { ok: false; error: unknown };

/**
 * Ergebnisse pro Konfigurations-Objekt und aktuellem Tick. StartConfig-Objekte werden nie
 * verändert (neue Pläne erzeugen neue Objekte), daher ist die Objekt-Identität ein sicherer Schlüssel.
 */
const planCache = new WeakMap<StartConfig, Map<number, PlanOutcome>>();
const PLAN_CACHE_TICKS_PER_CONFIG = 4;

/**
 * Simuliert den Plan: Jeder Eintrag startet genau an seinem `startTick`, fehlende Rohstoffe
 * machen das Konto negativ (`underfunded`). Simuliert wird bis max(aktueller Tick, Planende inkl.
 * Angriffsflüge) + FORECAST_TICKS. Das Ergebnis wird gecacht und geteilt, es darf nicht verändert werden.
 */
export function simulatePlan(startCfg: StartConfig, currentTick = computeCurrentTick(startCfg)): PlanResult {
  let byTick = planCache.get(startCfg);
  if (!byTick) {
    byTick = new Map();
    planCache.set(startCfg, byTick);
  }
  let outcome = byTick.get(currentTick);
  if (!outcome) {
    try {
      outcome = { ok: true, result: computePlan(startCfg, currentTick, "fixed") };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (byTick.size >= PLAN_CACHE_TICKS_PER_CONFIG) {
      const oldest = byTick.keys().next();
      if (!oldest.done) byTick.delete(oldest.value);
    }
    byTick.set(currentTick, outcome);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}

function computePlan(startCfg: StartConfig, currentTick: number, mode: StartMode): PlanResult {
  const map = byName(techtree);
  const plan =
    startCfg.plan.length > 0
      ? startCfg.plan
      : [
          {
            id: "fallback_koloniezentrum",
            kind: "tech" as const,
            name: "Koloniezentrum",
            startTick: 0,
          },
        ];

  const sim = runSimulation(plan, map, { ...startCfg, plan }, currentTick, mode);

  return {
    ...sim,
    // Beim Quereinstieg fehlen Techs bewusst im Plan – nur Gebäude/Forschung bleiben markiert.
    steps: startCfg.ignore_non_tech_deps
      ? sim.steps.map((s) => (s.blocked && s.type !== "building" && s.type !== "research" ? { ...s, blocked: false } : s))
      : sim.steps,
    start: { ...startCfg, plan },
  };
}

/** Einträge, die in Plan-Version 1 auf Rohstoffe gewartet haben; alle anderen liefen schon immer zum `startTick`. */
const LEGACY_DELAYABLE_KINDS = new Set<PlanEntry["kind"]>([
  "tech",
  "unit",
  "recon",
  "economy",
  "asteroids",
  "extractors",
  "custom",
  "trade",
]);

/**
 * Migriert einen Plan der Version 1 (Einträge warten auf Rohstoffe) auf feste Start-Ticks: Jeder
 * Eintrag bekommt den Tick, an dem er bisher tatsächlich gestartet ist. Ist der alte Plan nicht
 * simulierbar, bleiben die Einträge unverändert.
 */
export function migrateLegacyStartTicks(startCfg: StartConfig): PlanEntry[] {
  if (startCfg.plan.length === 0) return startCfg.plan;
  let actualStart: Record<string, number>;
  try {
    actualStart = computePlan(startCfg, 0, "legacy").entryActualStart;
  } catch {
    return startCfg.plan;
  }
  return startCfg.plan.map((entry) => {
    const tick = actualStart[entry.id];
    if (!LEGACY_DELAYABLE_KINDS.has(entry.kind) || tick === undefined || tick === entry.startTick) return entry;
    return { ...entry, startTick: tick };
  });
}

function estimateSteadyIncome(plan: PlanResult): Res {
  const completed = new Set(
    plan.steps
      .filter((s) => s.type === "building" || s.type === "research")
      .filter((s) => s.endTick <= plan.finishTick)
      .map((s) => s.name)
  );
  const mine = incomeFrom(completed);
  return {
    met: mine.met + plan.extractorsMetProducing * EXTRACTOR_INCOME_PER_UNIT,
    kris: mine.kris + plan.extractorsKrisProducing * EXTRACTOR_INCOME_PER_UNIT,
  };
}

const spendableCache = new WeakMap<PlanResult, Res[]>();

/**
 * Pro Snapshot: niedrigster Kontostand ab diesem Tick bis vor den nächsten manuellen Stand.
 * So viel kann ein neuer Eintrag an diesem Tick ausgeben, ohne spätere Einträge ins Minus zu ziehen.
 */
function spendableByIndex(plan: PlanResult): Res[] {
  const cached = spendableCache.get(plan);
  if (cached) return cached;
  const out: Res[] = new Array<Res>(plan.ticks.length);
  for (let i = plan.ticks.length - 1; i >= 0; i--) {
    const snap = plan.ticks[i]!;
    const next = i + 1 < plan.ticks.length ? plan.ticks[i + 1]! : null;
    const nextResets = !next || next.started.some((job) => job.type === "snapshot");
    out[i] = nextResets
      ? { met: snap.met, kris: snap.kris }
      : { met: Math.min(snap.met, out[i + 1]!.met), kris: Math.min(snap.kris, out[i + 1]!.kris) };
  }
  spendableCache.set(plan, out);
  return out;
}

/** Index des letzten Snapshots mit `tick <= tick`, oder -1. */
function snapshotIndexAt(plan: PlanResult, tick: number): number {
  let lo = 0;
  let hi = plan.ticks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (plan.ticks[mid]!.tick <= tick) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function spendableAt(plan: PlanResult, startCfg: StartConfig, tick: number): Res {
  const index = snapshotIndexAt(plan, tick);
  const last = plan.ticks.at(-1);
  if (index < 0 || !last) return { met: plan.finalRes.met, kris: plan.finalRes.kris };
  if (tick > last.tick) {
    // Nach dem Simulationsende wächst das Konto nur noch.
    return projectWithIncome(plan.finalRes, last.tick, tick, estimateSteadyIncome(plan), startCfg.taxes);
  }
  return spendableByIndex(plan)[index]!;
}

/** Frühester Tick ab `notBefore`, an dem `cost` ausgegeben werden kann, ohne dass das Konto später negativ wird. */
function earliestSpendableTick(plan: PlanResult, startCfg: StartConfig, cost: Res, notBefore: number): number {
  const spendable = spendableByIndex(plan);
  for (let i = Math.max(0, snapshotIndexAt(plan, notBefore)); i < plan.ticks.length; i++) {
    const tick = plan.ticks[i]!.tick;
    if (tick < notBefore) continue;
    if (canAfford(spendable[i]!, cost)) return tick;
  }
  const last = plan.ticks.at(-1);
  const steady = estimateSteadyIncome(plan);
  let met = plan.finalRes.met;
  let kris = plan.finalRes.kris;
  for (let t = (last?.tick ?? 0) + 1; t <= maxTicksOf(startCfg); t++) {
    const net = taxedIncome(steady, startCfg.taxes, t);
    met += net.met;
    kris += net.kris;
    if (t >= notBefore && met >= cost.met && kris >= cost.kris) return t;
  }
  return notBefore;
}

/** Tick, an dem alle genannten Techs laut Simulation fertig sind (0, wenn keine davon im Plan ist). */
function dependenciesReadyTick(plan: PlanResult, dependencies: string[]): number {
  let ready = 0;
  for (const dep of dependencies) {
    const job = plan.steps.find((s) => s.name === dep);
    if (job) ready = Math.max(ready, job.endTick);
  }
  return ready;
}

/**
 * Frühester Tick, an dem eine Tech starten kann: Voraussetzungen fertig und die Kosten
 * bezahlbar, ohne dass spätere Einträge ins Minus rutschen. Nie kleiner als 0.
 */
export function getEarliestTechStartTick(startCfg: StartConfig, techName: string): number {
  const tech = byName().get(techName);
  if (!tech) return 0;
  let plan: PlanResult;
  try {
    plan = simulatePlan(startCfg);
  } catch {
    return 0;
  }
  return earliestSpendableTick(plan, startCfg, tech.cost, dependenciesReadyTick(plan, tech.dependencies));
}

/** Frühester Tick für Unit/Recon: Voraussetzungen fertig und mind. 1 Stück bezahlbar (siehe oben). */
export function getEarliestBuildStartTick(startCfg: StartConfig, kind: "unit" | "recon", name: string): number {
  const item = kind === "unit" ? unitByName(name) : reconByName(name);
  if (!item) return 0;
  let plan: PlanResult;
  try {
    plan = simulatePlan(startCfg);
  } catch {
    return 0;
  }
  return earliestSpendableTick(plan, startCfg, item.cost, dependenciesReadyTick(plan, item.dependencies));
}

/**
 * Rohstoffe, die an einem Tick zusätzlich ausgegeben werden können, ohne dass das Konto
 * danach negativ wird (bis zum nächsten manuellen Stand).
 */
export function getSpendableResourcesAtTick(startCfg: StartConfig, tick: number): Res {
  try {
    return spendableAt(simulatePlan(startCfg), startCfg, tick);
  } catch {
    return { met: startCfg.starting_resources.metall, kris: startCfg.starting_resources.kristall };
  }
}

/** Max. Anzahl Units/Recon, die am Tick bezahlbar sind, ohne das Konto später ins Minus zu ziehen. */
export function getMaxBuildCountAtTick(startCfg: StartConfig, kind: "unit" | "recon", name: string, tick: number): number {
  const item = kind === "unit" ? unitByName(name) : reconByName(name);
  if (!item) return 0;
  const cost = item.cost;
  if (cost.met <= 0 && cost.kris <= 0) return 99;
  const { met, kris } = getSpendableResourcesAtTick(startCfg, tick);
  const byMet = cost.met > 0 ? met / cost.met : Infinity;
  const byKris = cost.kris > 0 ? kris / cost.kris : Infinity;
  return Math.max(0, Math.floor(Math.min(byMet, byKris)));
}

/**
 * Ressourcen-Snapshot an einem Tick (ggf. projiziert).
 */
export function getResourcesAtTick(
  startCfg: StartConfig,
  tick: number
): { met: number; kris: number; asteroids: number; extractorsMet: number; extractorsKris: number } {
  let plan: PlanResult;
  try {
    plan = simulatePlan(startCfg);
  } catch {
    return {
      met: startCfg.starting_resources.metall,
      kris: startCfg.starting_resources.kristall,
      asteroids: 0,
      extractorsMet: 0,
      extractorsKris: 0,
    };
  }

  const snap = plan.ticks.find((t) => t.tick === tick) ?? plan.ticks.filter((t) => t.tick <= tick).at(-1);

  if (snap && snap.tick === tick) {
    return {
      met: snap.met,
      kris: snap.kris,
      asteroids: snap.asteroids,
      extractorsMet: snap.extractorsMet,
      extractorsKris: snap.extractorsKris,
    };
  }

  const base = snap ?? {
    tick: 0,
    met: plan.finalRes.met,
    kris: plan.finalRes.kris,
    asteroids: plan.asteroids,
    extractorsMet: plan.extractorsMet,
    extractorsKris: plan.extractorsKris,
  };
  const projected = projectWithIncome({ met: base.met, kris: base.kris }, base.tick, tick, estimateSteadyIncome(plan), startCfg.taxes);
  return {
    met: projected.met,
    kris: projected.kris,
    asteroids: "asteroids" in base ? base.asteroids : plan.asteroids,
    extractorsMet: "extractorsMet" in base ? base.extractorsMet : plan.extractorsMet,
    extractorsKris: "extractorsKris" in base ? base.extractorsKris : plan.extractorsKris,
  };
}

/**
 * Max. Extraktoren an Tick, ohne Auto-Asteroiden-Kauf.
 * `freeSlots` begrenzt zusätzlich.
 */
export function getMaxExtractorsAtTick(
  startCfg: StartConfig,
  tick: number
): { max: number; freeSlots: number; asteroids: number; alreadyBuilt: number } {
  const r = getResourcesAtTick(startCfg, tick);
  const spendable = getSpendableResourcesAtTick(startCfg, tick);
  const alreadyBuilt = r.extractorsMet + r.extractorsKris;
  const slots = r.asteroids * EXTRACTOR_SLOT_PER_ASTEROID;
  const freeSlots = Math.max(0, slots - alreadyBuilt);
  const maxByRes = maxAffordableExtractors({
    met: spendable.met,
    kris: spendable.kris,
    alreadyBuilt,
    asteroids: r.asteroids,
    slots,
    allowBuyAsteroids: false,
  });
  return {
    max: Math.min(maxByRes, freeSlots),
    freeSlots,
    asteroids: r.asteroids,
    alreadyBuilt,
  };
}

export function getEarliestExtractorStartTick(startCfg: StartConfig): number {
  let plan: PlanResult;
  try {
    plan = simulatePlan(startCfg);
  } catch {
    return 0;
  }
  const job = plan.steps.find((s) => s.name === "Extraktor");
  return job?.endTick ?? 0;
}

export function getEarliestAsteroidStartTick(startCfg: StartConfig): number {
  let plan: PlanResult;
  try {
    plan = simulatePlan(startCfg);
  } catch {
    return 0;
  }
  const job = plan.steps.find((s) => s.name === "Observatorium");
  return job?.endTick ?? 0;
}
