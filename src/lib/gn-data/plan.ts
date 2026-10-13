import { balanced } from "@/lib/gn-data/plan-template/balanced.ts";
import { empty } from "@/lib/gn-data/plan-template/empty.ts";

/** Weiterer Angreifer beim Roid, relativ zum eigenen Angriffsbeginn. */
export type RoidCoAttacker = {
  /** Start relativ zum eigenen ersten Angriffs-Tick (0 = gleichzeitig). */
  startOffset: number;
  /** Anzahl Ticks, die dieser Angreifer mitroidet. */
  duration: number;
  /** Cleptoren dieses Angreifers zu seinem Start. */
  cleptors: number;
};

export type RoidMulti = {
  /** Eigene Cleptoren zu Angriffsbeginn. */
  ownCleptors: number;
  attackers: RoidCoAttacker[];
};

export type PlanEntry =
  | { id: string; kind: "tech"; name: string; startTick: number }
  | { id: string; kind: "unit"; name: string; startTick: number; count: number }
  | { id: string; kind: "recon"; name: string; startTick: number; count: number }
  /** Asteroiden scannen und/oder Extraktoren bauen — ein Timeline-Event. */
  | {
      id: string;
      kind: "economy";
      startTick: number;
      /** Anzahl Asteroiden (0 = nur Extraktoren). */
      asteroids: number;
      /** Metallextraktoren (0 = keine). */
      extractorsMet: number;
      /** Kristallextraktoren (0 = keine). */
      extractorsKris: number;
    }
  /** Beliebige Ressourcen-Ausgabe mit Label (instant). */
  | {
      id: string;
      kind: "custom";
      startTick: number;
      label: string;
      cost: { met: number; kris: number };
    }
  /** Rohstoffe tauschen (Interstellarer Handel, instant). */
  | {
      id: string;
      kind: "trade";
      startTick: number;
      /** Abgegebener Rohstoff. */
      give: "met" | "kris";
      /** Menge die abgegeben wird. */
      giveAmount: number;
      /** Menge die vom anderen Rohstoff ankommt. */
      receiveAmount: number;
    }
  /**
   * Extraktoren erbeuten (Roid): 10% der Ziel-Exen pro Tick, kostenlos.
   * @deprecated Neue Roids laufen über `attack`; bestehende Einträge bleiben gültig.
   */
  | {
      id: string;
      kind: "roid";
      startTick: number;
      /** Opfer-Bestand Metall-Exen zu Angriffsbeginn. */
      targetMet: number;
      /** Opfer-Bestand Kristall-Exen zu Angriffsbeginn. */
      targetKris: number;
      /** Anzahl Angriffs-Ticks (1–10). */
      duration: number;
      /** Weitere Angreifer gleichzeitig: Beute wird anteilig nach Cleptoren aufgeteilt. */
      multi?: RoidMulti;
    }
  /** Eigene Extraktoren verlieren (Katastrophe): 10% der eigenen Exen pro Tick. */
  | {
      id: string;
      kind: "catastrophe";
      startTick: number;
      /** Anzahl Angriffs-Ticks (1–25). */
      duration: number;
    }
  /**
   * Angriffsflug: 30 Ticks Hinflug, Kampf (1–10 Ticks), 30 Ticks Rückflug. Mit Ziel-Exen
   * wird im Kampf wie beim Roid erbeutet; ohne Ziel-Exen nur in der Timeline.
   */
  | {
      id: string;
      kind: "attack";
      /** Abflug-Tick. */
      startTick: number;
      /** Anzahl Kampf-Ticks (1–10). */
      duration: number;
      /**
       * Roid-Ticks (1–duration), immer die letzten Kampfticks; davor reiner Flottenkampf.
       * Fehlt = ganzer Kampf ist Roid.
       */
      roidDuration?: number;
      /** Opfer-Bestand Metall-Exen zum Roid-Beginn (0 = kein Roid). */
      targetMet: number;
      /** Opfer-Bestand Kristall-Exen zu Kampfbeginn (0 = kein Roid). */
      targetKris: number;
      /** Weitere Angreifer gleichzeitig: Beute wird anteilig nach Cleptoren aufgeteilt. */
      multi?: RoidMulti;
      /** Angriff endet nach dem Kampf (kein Rückflug). */
      noReturn?: boolean;
    }
  /** Manueller Ressourcen-/Exen-Stand ab diesem Tick. */
  | {
      id: string;
      kind: "snapshot";
      startTick: number;
      met: number;
      kris: number;
      extractorsMet: number;
      extractorsKris: number;
      asteroids: number;
    }
  /** @deprecated migrated to economy */
  | {
      id: string;
      kind: "extractors";
      resource: "met" | "kris";
      startTick: number;
      count: number;
    }
  /** @deprecated migrated to economy */
  | { id: string; kind: "asteroids"; startTick: number; count: number };

export type PlanTemplate = {
  id: string;
  label: string;
  plan: PlanEntry[];
};

export const PLAN_SLOT_IDS = [1, 2, 3] as const;
export type PlanSlotId = (typeof PLAN_SLOT_IDS)[number];

export function isPlanSlotId(value: unknown): value is PlanSlotId {
  return value === 1 || value === 2 || value === 3;
}

export function planSlotLabel(id: PlanSlotId): string {
  return `Plan ${id}`;
}

export function clonePlanEntries(plan: PlanEntry[]): PlanEntry[] {
  return structuredClone(plan);
}

export const planTemplates: PlanTemplate[] = [empty, balanced];

export const defaults: {
  /** Länge eines Ticks in Minuten (GN: normalerweise 15). */
  tick_minutes: number;
  /** Simulations-Horizont / Safety-Cap in Ticks. */
  max_ticks: number;
  /** Voraussichtliches Rundenende in Ticks. */
  round_end_tick: number;
  starting_resources: { metall: number; kristall: number };
  taxes: { fromTick: number; met: number; kris: number }[];
  plan: PlanEntry[];
} = {
  tick_minutes: 15,
  max_ticks: 80 * 96,
  round_end_tick: 80 * 96,
  starting_resources: {
    metall: 10500,
    kristall: 10500,
  },
  taxes: [],
  plan: [...balanced.plan],
};
