import { useMemo } from "react";

import { computeCurrentTick, simulatePlan } from "@/lib/calculate-fastest-way-to-goal.ts";
import { configFromPlan, localDateKey, type StoredPlan } from "@/lib/utils/plan-data.ts";

import { useNow } from "@/hooks/useNow.tsx";

/** Simuliert den Plan bis zum aktuellen Tick und bestimmt die nächste spielbare Aktion. */
export function usePlanSimulation(stored: StoredPlan) {
  const now = useNow();
  const today = localDateKey(now);
  const startCfg = useMemo(() => configFromPlan(stored, today), [stored, today]);
  const currentTick = computeCurrentTick(startCfg, now);

  const plan = useMemo(() => {
    try {
      return simulatePlan(startCfg, currentTick);
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [startCfg, currentTick]);

  const actionTicks = useMemo(() => (plan ? plan.ticks.filter((t) => t.started.length > 0) : []), [plan]);

  const nextAction = useMemo(() => {
    const ticks = actionTicks.filter((t) =>
      t.started.some((job) => job.type !== "custom" && job.type !== "trade" && job.type !== "snapshot")
    );
    return ticks.find((t) => t.tick >= currentTick) ?? null;
  }, [actionTicks, currentTick]);

  return { now, today, startCfg, currentTick, plan, actionTicks, nextAction };
}
