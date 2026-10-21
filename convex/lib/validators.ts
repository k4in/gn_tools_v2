import { v, type Infer } from "convex/values";

export const planSlotValidator = v.union(v.literal(1), v.literal(2), v.literal(3));

const roidMultiValidator = v.object({
  ownCleptors: v.number(),
  attackers: v.array(
    v.object({
      startOffset: v.number(),
      duration: v.number(),
      cleptors: v.number(),
    })
  ),
});

/** Plan-Einträge ohne die Legacy-Formate; die werden beim Import im Client umgewandelt. */
export const planEntryValidator = v.union(
  v.object({ id: v.string(), kind: v.literal("tech"), name: v.string(), startTick: v.number() }),
  v.object({ id: v.string(), kind: v.literal("unit"), name: v.string(), startTick: v.number(), count: v.number() }),
  v.object({ id: v.string(), kind: v.literal("recon"), name: v.string(), startTick: v.number(), count: v.number() }),
  v.object({
    id: v.string(),
    kind: v.literal("economy"),
    startTick: v.number(),
    asteroids: v.number(),
    extractorsMet: v.number(),
    extractorsKris: v.number(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("custom"),
    startTick: v.number(),
    label: v.string(),
    cost: v.object({ met: v.number(), kris: v.number() }),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("trade"),
    startTick: v.number(),
    give: v.union(v.literal("met"), v.literal("kris")),
    giveAmount: v.number(),
    receiveAmount: v.number(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("roid"),
    startTick: v.number(),
    targetMet: v.number(),
    targetKris: v.number(),
    duration: v.number(),
    multi: v.optional(roidMultiValidator),
  }),
  v.object({ id: v.string(), kind: v.literal("catastrophe"), startTick: v.number(), duration: v.number() }),
  v.object({
    id: v.string(),
    kind: v.literal("attack"),
    startTick: v.number(),
    duration: v.number(),
    roidDuration: v.optional(v.number()),
    targetMet: v.number(),
    targetKris: v.number(),
    multi: v.optional(roidMultiValidator),
    noReturn: v.optional(v.boolean()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("snapshot"),
    startTick: v.number(),
    met: v.number(),
    kris: v.number(),
    extractorsMet: v.number(),
    extractorsKris: v.number(),
    asteroids: v.number(),
  })
);

export const taxSegmentValidator = v.object({
  fromTick: v.number(),
  met: v.number(),
  kris: v.number(),
});

export const planSettingsValidator = v.object({
  /** `YYYY-MM-DD`; `null` = Tick 0 ist heute 00:00. */
  startDate: v.union(v.string(), v.null()),
  /** `HH:MM`, gilt nur mit `startDate`. */
  startTime: v.string(),
  tickMinutes: v.number(),
  historyWindow: v.union(v.literal("recent"), v.literal("all")),
});

/**
 * Version der Plan-Semantik. 1 (fehlt): Einträge starten frühestens am `startTick` und warten auf
 * Rohstoffe. 2: Einträge starten genau am `startTick`, fehlende Rohstoffe machen das Konto negativ.
 */
export const CURRENT_PLAN_VERSION = 2;

export const planFields = {
  entries: v.array(planEntryValidator),
  /** Fehlt bei Plänen von vor Version 2; die werden im Client migriert. */
  planVersion: v.optional(v.number()),
  taxes: v.array(taxSegmentValidator),
  /** Quereinstieg: fehlende Voraussetzungen bei Einheiten und Wirtschaft ignorieren. */
  ignoreNonTechDeps: v.boolean(),
  settings: planSettingsValidator,
};

export const DEFAULT_PLAN_SETTINGS: Infer<typeof planSettingsValidator> = {
  startDate: null,
  startTime: "00:00",
  tickMinutes: 15,
  historyWindow: "recent",
};
