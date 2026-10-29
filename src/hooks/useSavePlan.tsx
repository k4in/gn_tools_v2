import { CURRENT_PLAN_VERSION } from "@convex/lib/validators.ts";

import { type PlanEntry, type PlanSlotId } from "@/lib/gn-data/plan.ts";
import { toStoredEntries, type PlanSettings, type StoredPlan } from "@/lib/utils/plan-data.ts";

import { useUpdatePlan } from "@/hooks/useUpdatePlan.tsx";

export type PlanPatch = {
  entries?: PlanEntry[];
  taxes?: StoredPlan["taxes"];
  ignoreNonTechDeps?: boolean;
  settings?: PlanSettings;
};

function logMutationError(error: unknown) {
  console.error("Konnte Plan nicht speichern", error);
}

/** Speichert Änderungen am Plan im gegebenen Slot. */
export function useSavePlan(userKey: string, slot: PlanSlotId) {
  const updatePlan = useUpdatePlan();

  return function savePlan(patch: PlanPatch) {
    const { entries, ...rest } = patch;
    void updatePlan({
      key: userKey,
      slot,
      ...rest,
      // Einträge kommen immer aus einer (ggf. migrierten) Config und haben damit die aktuelle Semantik.
      ...(entries ? { entries: toStoredEntries(entries), planVersion: CURRENT_PLAN_VERSION } : {}),
    }).catch(logMutationError);
  };
}
