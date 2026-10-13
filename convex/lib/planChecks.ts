import { ConvexError, type Infer } from "convex/values";

import { type planEntryValidator, type planSettingsValidator, type taxSegmentValidator } from "./validators.ts";

const MAX_PLAN_ENTRIES = 1000;
const MAX_TAX_SEGMENTS = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function assertPlanEntries(entries: Infer<typeof planEntryValidator>[]) {
  if (entries.length > MAX_PLAN_ENTRIES) {
    throw new ConvexError(`Ein Plan darf höchstens ${MAX_PLAN_ENTRIES} Einträge haben.`);
  }
}

export function assertTaxes(taxes: Infer<typeof taxSegmentValidator>[]) {
  if (taxes.length > MAX_TAX_SEGMENTS) {
    throw new ConvexError(`Höchstens ${MAX_TAX_SEGMENTS} Steuer-Abschnitte.`);
  }
}

export function assertPlanSettings(settings: Infer<typeof planSettingsValidator>) {
  if (settings.startDate !== null && !DATE_PATTERN.test(settings.startDate)) {
    throw new ConvexError("Ungültiges Startdatum.");
  }
  if (!TIME_PATTERN.test(settings.startTime)) {
    throw new ConvexError("Ungültige Startzeit.");
  }
  if (!Number.isInteger(settings.tickMinutes) || settings.tickMinutes < 1 || settings.tickMinutes > 24 * 60) {
    throw new ConvexError("Ungültige Tick-Länge.");
  }
}
