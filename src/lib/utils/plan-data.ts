import { type FunctionReturnType } from "convex/server";

import { type api } from "@convex/_generated/api.ts";
import { CURRENT_PLAN_VERSION } from "@convex/lib/validators.ts";

import { defaults, type PlanEntry } from "@/lib/gn-data/plan.ts";
import {
  clampAttackDuration,
  clampAttackRoidDuration,
  migrateLegacyStartTicks,
  newPlanEntryId,
  normalizeRoidMulti,
  normalizeTaxes,
  type StartConfig,
  type TaxSegment,
} from "@/lib/calculate-fastest-way-to-goal.ts";
import { parseHistoryWindow } from "@/lib/history-window.ts";

/** Ein Plan-Slot, wie ihn Convex liefert. */
export type StoredPlan = FunctionReturnType<typeof api.plans.list>[number];
export type StoredPlanEntry = StoredPlan["entries"][number];
export type PlanSettings = StoredPlan["settings"];

export const MAX_IMPORT_PLAN_ENTRIES = 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const TECH_RENAMES: Record<string, string> = {
  "Aufwertung des Militärscans": "Erweiterter Militärscan",
  "Aufwertung des Nachrichtenscans": "Erweiterter Nachrichtenscan",
};

function renameTech(name: string): string {
  return TECH_RENAMES[name] ?? name;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Ganze Zahl ≥ 0, sonst `null`. */
function nonNegativeInt(value: unknown): number | null {
  return isFiniteNumber(value) ? Math.max(0, Math.floor(value)) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function economyEntry(id: string, startTick: number, asteroids: number, extractorsMet: number, extractorsKris: number) {
  if (asteroids <= 0 && extractorsMet <= 0 && extractorsKris <= 0) return null;
  return { id, kind: "economy" as const, startTick, asteroids, extractorsMet, extractorsKris };
}

/**
 * Prüft einen Plan-Eintrag aus beliebiger Quelle und baut ihn neu auf, damit nur bekannte Felder
 * übrig bleiben. Legacy-Formate (`asteroids`, `extractors`, alte `economy`, Text-Einträge) werden umgewandelt.
 */
function sanitizePlanEntry(raw: unknown): StoredPlanEntry | null {
  if (typeof raw === "string") {
    const name = nonEmptyString(raw);
    return name ? { id: newPlanEntryId("legacy"), kind: "tech", name: renameTech(name), startTick: 0 } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = nonEmptyString(o.id);
  const startTick = nonNegativeInt(o.startTick);
  if (!id || startTick === null) return null;

  switch (o.kind) {
    case "tech": {
      const name = nonEmptyString(o.name);
      return name ? { id, kind: "tech", name: renameTech(name), startTick } : null;
    }
    case "unit":
    case "recon": {
      const name = nonEmptyString(o.name);
      if (!name || !isFiniteNumber(o.count) || o.count <= 0) return null;
      return { id, kind: o.kind, name, startTick, count: Math.max(1, Math.floor(o.count)) };
    }
    case "economy": {
      const asteroids = nonNegativeInt(o.asteroids) ?? 0;
      if (typeof o.extractorsMet === "number" || typeof o.extractorsKris === "number") {
        return economyEntry(id, startTick, asteroids, nonNegativeInt(o.extractorsMet) ?? 0, nonNegativeInt(o.extractorsKris) ?? 0);
      }
      // Älteres Format: eine Extraktor-Anzahl plus Rohstoff.
      const extractors = nonNegativeInt(o.extractors) ?? 0;
      if (extractors > 0 && o.resource !== "met" && o.resource !== "kris") return null;
      return economyEntry(id, startTick, asteroids, o.resource === "kris" ? 0 : extractors, o.resource === "kris" ? extractors : 0);
    }
    case "extractors": {
      if ((o.resource !== "met" && o.resource !== "kris") || !isFiniteNumber(o.count) || o.count <= 0) return null;
      const count = Math.max(1, Math.floor(o.count));
      return economyEntry(id, startTick, 0, o.resource === "met" ? count : 0, o.resource === "kris" ? count : 0);
    }
    case "asteroids": {
      if (!isFiniteNumber(o.count) || o.count <= 0) return null;
      return economyEntry(id, startTick, Math.max(1, Math.floor(o.count)), 0, 0);
    }
    case "custom": {
      const label = nonEmptyString(o.label);
      const cost = o.cost && typeof o.cost === "object" ? (o.cost as Record<string, unknown>) : null;
      const met = nonNegativeInt(cost?.met);
      const kris = nonNegativeInt(cost?.kris);
      if (!label || met === null || kris === null) return null;
      return { id, kind: "custom", startTick, label, cost: { met, kris } };
    }
    case "trade": {
      const giveAmount = nonNegativeInt(o.giveAmount);
      const receiveAmount = nonNegativeInt(o.receiveAmount);
      if ((o.give !== "met" && o.give !== "kris") || giveAmount === null || receiveAmount === null) return null;
      if (giveAmount <= 0 && receiveAmount <= 0) return null;
      return { id, kind: "trade", startTick, give: o.give, giveAmount, receiveAmount };
    }
    case "roid": {
      const targetMet = nonNegativeInt(o.targetMet);
      const targetKris = nonNegativeInt(o.targetKris);
      if (targetMet === null || targetKris === null || !isFiniteNumber(o.duration)) return null;
      if (targetMet <= 0 && targetKris <= 0) return null;
      const multi = normalizeRoidMulti(o.multi);
      return {
        id,
        kind: "roid",
        startTick,
        targetMet,
        targetKris,
        duration: Math.min(10, Math.max(1, Math.floor(o.duration))),
        ...(multi ? { multi } : {}),
      };
    }
    case "catastrophe": {
      if (!isFiniteNumber(o.duration)) return null;
      return { id, kind: "catastrophe", startTick, duration: Math.min(25, Math.max(1, Math.floor(o.duration))) };
    }
    case "attack": {
      if (!isFiniteNumber(o.duration)) return null;
      const duration = clampAttackDuration(o.duration);
      const multi = normalizeRoidMulti(o.multi);
      return {
        id,
        kind: "attack",
        startTick,
        duration,
        roidDuration: clampAttackRoidDuration(isFiniteNumber(o.roidDuration) ? o.roidDuration : undefined, duration),
        // Ziel-Exen sind optional (ältere Angriffsflüge hatten keine).
        targetMet: nonNegativeInt(o.targetMet) ?? 0,
        targetKris: nonNegativeInt(o.targetKris) ?? 0,
        ...(multi ? { multi } : {}),
        ...(o.noReturn === true ? { noReturn: true } : {}),
      };
    }
    case "snapshot": {
      const met = nonNegativeInt(o.met);
      const kris = nonNegativeInt(o.kris);
      const extractorsMet = nonNegativeInt(o.extractorsMet);
      const extractorsKris = nonNegativeInt(o.extractorsKris);
      const asteroids = nonNegativeInt(o.asteroids);
      if (met === null || kris === null || extractorsMet === null || extractorsKris === null || asteroids === null) return null;
      return { id, kind: "snapshot", startTick, met, kris, extractorsMet, extractorsKris, asteroids };
    }
    default:
      return null;
  }
}

function sanitizePlanEntries(raw: unknown[]): StoredPlanEntry[] {
  return raw.flatMap((item) => sanitizePlanEntry(item) ?? []);
}

/** Bringt Einträge aus dem Planer in das Format, das Convex speichert. */
export function toStoredEntries(entries: PlanEntry[]): StoredPlanEntry[] {
  return sanitizePlanEntries(entries);
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Einstellungen aus einem Export; ungültige Felder fallen auf `fallback` zurück. */
function parsePlanSettings(raw: unknown, fallback: PlanSettings): PlanSettings {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const startDate =
    o.startDate === null ? null : typeof o.startDate === "string" && isValidDate(o.startDate) ? o.startDate : fallback.startDate;
  const startTime = typeof o.startTime === "string" && TIME_PATTERN.test(o.startTime) ? o.startTime : fallback.startTime;
  const tickMinutes =
    isFiniteNumber(o.tickMinutes) && Number.isInteger(o.tickMinutes) && o.tickMinutes >= 1 && o.tickMinutes <= 24 * 60
      ? o.tickMinutes
      : fallback.tickMinutes;
  const historyWindow = o.historyWindow === undefined ? fallback.historyWindow : parseHistoryWindow(o.historyWindow);
  return { startDate, startTime, tickMinutes, historyWindow };
}

export type ImportedPlan = {
  entries: StoredPlanEntry[];
  /** Fehlt in Exporten von vor Version 2: dann müssen die Einträge migriert werden. */
  planVersion?: number;
  taxes: TaxSegment[];
  /** Fehlt in Legacy-Exporten: dann bleibt der Wert des Slots. */
  ignoreNonTechDeps?: boolean;
  /** Fehlt in Legacy-Exporten: dann bleiben die Einstellungen des Slots. */
  settings?: PlanSettings;
};

export type ImportPlanParseResult = ({ ok: true } & ImportedPlan) | { ok: false; error: string };

/**
 * Liest ein exportiertes Plan-JSON. Akzeptiert den aktuellen Export, den Export der Legacy-App
 * (`{ plan, taxes }`) und ein reines Plan-Array.
 */
export function parseImportedPlan(text: string, currentSettings: PlanSettings): ImportPlanParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Kein JSON eingefügt." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Ungültiges JSON." };
  }

  let rawEntries: unknown = parsed;
  let obj: Record<string, unknown> | null = null;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    obj = parsed as Record<string, unknown>;
    rawEntries = obj.plan;
  }
  if (!Array.isArray(rawEntries)) {
    return { ok: false, error: "JSON muss ein Plan-Array oder { plan, taxes } sein." };
  }
  if (rawEntries.length > MAX_IMPORT_PLAN_ENTRIES) {
    return { ok: false, error: `Maximal ${MAX_IMPORT_PLAN_ENTRIES} Einträge.` };
  }
  const entries = sanitizePlanEntries(rawEntries);
  if (entries.length === 0) {
    return { ok: false, error: "Keine gültigen Plan-Einträge gefunden." };
  }

  return {
    ok: true,
    entries,
    ...(isFiniteNumber(obj?.planVersion) ? { planVersion: obj.planVersion } : {}),
    taxes: normalizeTaxes(obj?.taxes),
    ...(typeof obj?.ignoreNonTechDeps === "boolean" ? { ignoreNonTechDeps: obj.ignoreNonTechDeps } : {}),
    ...(obj?.settings !== undefined ? { settings: parsePlanSettings(obj.settings, currentSettings) } : {}),
  };
}

/** Export-JSON eines Slots. `plan` und `taxes` bleiben kompatibel zum Import der Legacy-App. */
export function planExportJson(plan: StoredPlan): string {
  return JSON.stringify(
    {
      plan: plan.entries,
      planVersion: plan.planVersion,
      taxes: plan.taxes,
      ignoreNonTechDeps: plan.ignoreNonTechDeps,
      settings: plan.settings,
    },
    null,
    2
  );
}

/** Lokales Datum als `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Ob die Einträge noch die Semantik von Plan-Version 1 haben (Start wartet auf Rohstoffe). */
export function needsPlanMigration(plan: Pick<StoredPlan, "planVersion">): boolean {
  return (plan.planVersion ?? 1) < CURRENT_PLAN_VERSION;
}

/**
 * Rechen-Config eines Slots. Ohne Startdatum ist Tick 0 heute (`today`) um 00:00.
 * Pläne alter Versionen werden dabei migriert; der Planer speichert das Ergebnis einmalig.
 */
export function configFromPlan(plan: StoredPlan, today: string): StartConfig {
  const cfg = rawConfigFromPlan(plan, today);
  return needsPlanMigration(plan) ? { ...cfg, plan: migrateLegacyStartTicks(cfg) } : cfg;
}

function rawConfigFromPlan(plan: StoredPlan, today: string): StartConfig {
  const { startDate, startTime, tickMinutes } = plan.settings;
  return {
    start_date: startDate ?? today,
    start_time: startDate ? startTime : "00:00",
    tick_minutes: tickMinutes,
    max_ticks: defaults.max_ticks,
    round_end_tick: defaults.round_end_tick,
    starting_resources: { ...defaults.starting_resources },
    taxes: plan.taxes,
    ignore_non_tech_deps: plan.ignoreNonTechDeps,
    plan: plan.entries,
  };
}
