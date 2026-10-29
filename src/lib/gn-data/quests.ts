// wir berücksichtigen hier erstmal nur alle quests die bis zu extraktoren relevant sind. Andere quests folgen später. Quests sind besondere Aufgaben die Rohstoffe als Questbelohnung bei Erfüllung ausschütten. Selten auch Einheiten, aber das ist für uns erstmal nicht relevant.

export type QuestReward = { kind: "res"; met: number; kris: number } | { kind: "extractors"; resource: "met" | "kris"; count: number };

export type QuestContext = {
  completed: ReadonlySet<string>;
  asteroids: number;
  extractorsMet: number;
  extractorsKris: number;
  scanverstaerker: number;
  tick: number;
  /** Erster Angriffstick des ersten Roids, sonst null. */
  firstRoidStartTick: number | null;
  /** Fertiggestellte Cancri (kumulativ). */
  cancri: number;
};

export type QuestDef = {
  id: string;
  /** Kurzlabel für die Quest-Spalte im Tick-Protokoll. */
  label: string;
  /** Anzeigename in der Quest-Übersicht. */
  title: string;
  /** Bedingung in Worten. */
  description: string;
  reward: QuestReward;
  isComplete: (ctx: QuestContext) => boolean;
};

export function hasAll(completed: ReadonlySet<string>, names: string[]) {
  return names.every((n) => completed.has(n));
}

export function hasAny(completed: ReadonlySet<string>, names: string[]) {
  return names.some((n) => completed.has(n));
}

function resLabel(met: number, kris: number): string {
  const parts: string[] = [];
  if (met) parts.push(`+${met}M`);
  if (kris) parts.push(`+${kris}K`);
  return parts.join(", ");
}

function resQuest(
  id: string,
  title: string,
  description: string,
  met: number,
  kris: number,
  isComplete: (ctx: QuestContext) => boolean
): QuestDef {
  return {
    id,
    label: resLabel(met, kris),
    title,
    description,
    reward: { kind: "res", met, kris },
    isComplete,
  };
}

export const QUESTS: QuestDef[] = [
  resQuest("koloniezentrum", "Koloniezentrum", "Koloniezentrum bauen", 1000, 0, (ctx) => ctx.completed.has("Koloniezentrum")),
  resQuest("basic-mines", "Erste Minen", "Metallmine und Kristallmine bauen", 0, 2000, (ctx) =>
    hasAll(ctx.completed, ["Metallmine", "Kristallmine"])
  ),
  resQuest("deep-mines", "Tiefe Minen", "Tiefe Metallminen und Tiefe Kristallminen bauen", 6000, 4000, (ctx) =>
    hasAll(ctx.completed, ["Tiefe Metallminen", "Tiefe Kristallminen"])
  ),
  resQuest("auto-mines", "Vollautomatisierte Minen", "Vollautomatisierte Metall- und Kristallmine bauen", 10000, 20000, (ctx) =>
    hasAll(ctx.completed, ["Vollautomatisierte Metallmine", "Vollautomatisierte Kristallmine"])
  ),
  resQuest("extraktor-research", "Extraktor", "Extraktor erforschen", 10000, 10000, (ctx) => ctx.completed.has("Extraktor")),
  resQuest("raumstation", "Raumstation", "Raumstation bauen", 12000, 5000, (ctx) => ctx.completed.has("Raumstation")),
  resQuest("sektorscan", "Sektorscan", "Sektorscan erforschen", 10000, 20000, (ctx) => ctx.completed.has("Sektorscan")),
  resQuest(
    "einheiten-oder-geschuetzscan",
    "Einheiten- oder Geschützscan",
    "Einheitenscan oder Geschützscan erforschen",
    25000,
    20000,
    (ctx) => hasAny(ctx.completed, ["Einheitenscan", "Geschützscan"])
  ),
  resQuest(
    "first-scanverstaerker",
    "Erster Scanverstärker",
    "Mindestens 1 Scanverstärker bauen",
    10000,
    25000,
    (ctx) => ctx.scanverstaerker >= 1
  ),
  {
    id: "asteroid-met-extractors",
    label: "+10 K-Exen",
    title: "Zehn Metall-Extraktoren",
    description: "Mindestens 1 Asteroid und 10 Metall-Extraktoren",
    reward: { kind: "extractors", resource: "kris", count: 10 },
    isComplete: (ctx) => ctx.asteroids >= 1 && ctx.extractorsMet >= 10,
  },
  // 2. Angriffstick des ersten Roids; bei Dauer 1 der Tick danach.
  resQuest(
    "first-roid",
    "Erster Extraktor",
    "Ersten Extraktor erobern (2. Angriffstick)",
    60000,
    80000,
    (ctx) => ctx.firstRoidStartTick !== null && ctx.tick >= ctx.firstRoidStartTick + 1
  ),
  resQuest("cancri-100", "100 Cancri", "100 Cancri bauen", 50000, 75000, (ctx) => ctx.cancri >= 100),
];

/** Noch nicht beanspruchte Quests, die jetzt erfüllt sind. */
export function evaluateQuests(ctx: QuestContext, claimed: ReadonlySet<string>): QuestDef[] {
  return QUESTS.filter((q) => !claimed.has(q.id) && q.isComplete(ctx));
}

export function formatQuestReward(reward: QuestReward): string {
  if (reward.kind === "extractors") {
    return reward.resource === "met" ? `+${reward.count} Met-Ext` : `+${reward.count} Kris-Ext`;
  }
  return resLabel(reward.met, reward.kris) || "—";
}
