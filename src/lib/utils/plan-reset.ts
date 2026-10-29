import { isPlanSlotId, PLAN_SLOT_IDS, planSlotLabel, planTemplates, type PlanSlotId } from "@/lib/gn-data/plan.ts";
import { configFromPlan, type StoredPlan } from "@/lib/utils/plan-data.ts";

export type ResetSource = {
  id: string;
  label: string;
};

/** Vorlagen und die anderen Slots, mit denen der Plan im Slot ersetzt werden kann. */
export function planResetSources(slot: PlanSlotId): ResetSource[] {
  return [
    ...planTemplates.map((template) => ({ id: `template:${template.id}`, label: template.label })),
    ...PLAN_SLOT_IDS.filter((id) => id !== slot).map((id) => ({ id: `plan:${id}`, label: planSlotLabel(id) })),
  ];
}

/** Was beim Zurücksetzen auf die Quelle gespeichert wird; null, wenn die Quelle ungültig ist. */
export function planResetPatch(sourceId: string, plans: StoredPlan[], slot: PlanSlotId, today: string) {
  if (sourceId.startsWith("template:")) {
    const templateId = sourceId.slice("template:".length);
    const template = planTemplates.find((item) => item.id === templateId);
    if (!template) return null;
    return { entries: template.plan, taxes: [], ignoreNonTechDeps: false };
  }
  if (sourceId.startsWith("plan:")) {
    const id = Number(sourceId.slice("plan:".length));
    const source = plans.find((item) => item.slot === id);
    if (!isPlanSlotId(id) || id === slot || !source) return null;
    // Die Einstellungen (Startzeit usw.) gehören zum Slot und bleiben.
    return { entries: configFromPlan(source, today).plan, taxes: source.taxes, ignoreNonTechDeps: source.ignoreNonTechDeps };
  }
  return null;
}
