import { useMutation } from "convex/react";

import { api } from "@convex/_generated/api.ts";

/** `plans.update` mit optimistischem Update, damit der Planer ohne Server-Rundlauf reagiert. */
export function useUpdatePlan() {
  return useMutation(api.plans.update).withOptimisticUpdate((localStore, { key, slot, ...patch }) => {
    const plans = localStore.getQuery(api.plans.list, { key });
    if (!plans) return;
    localStore.setQuery(
      api.plans.list,
      { key },
      plans.map((plan) =>
        plan.slot === slot
          ? {
              ...plan,
              ...(patch.entries ? { entries: patch.entries } : {}),
              ...(patch.planVersion !== undefined ? { planVersion: patch.planVersion } : {}),
              ...(patch.taxes ? { taxes: patch.taxes } : {}),
              ...(patch.ignoreNonTechDeps !== undefined ? { ignoreNonTechDeps: patch.ignoreNonTechDeps } : {}),
              ...(patch.settings ? { settings: patch.settings } : {}),
            }
          : plan
      )
    );
  });
}
