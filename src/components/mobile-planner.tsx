import { planSlotLabel, type PlanSlotId } from "@/lib/gn-data/plan.ts";
import { formatTimeUntilTick, formatWallClock, type Job } from "@/lib/calculate-fastest-way-to-goal.ts";
import { planResetPatch, planResetSources } from "@/lib/utils/plan-reset.ts";
import { type StoredPlan } from "@/lib/utils/plan-data.ts";

import { usePlanSimulation } from "@/hooks/usePlanSimulation.tsx";
import { useSavePlan } from "@/hooks/useSavePlan.tsx";

import { Badge } from "@/components/shadcn/badge.tsx";

import { ActionPlan, JobList } from "@/components/overview/actionplan.tsx";
import { ResetPlanDialog } from "@/components/reset-plan-dialog.tsx";
import { SettingsDialog } from "@/components/settings-dialog.tsx";
import { TaxesDialog } from "@/components/taxes-dialog.tsx";

type MobilePlannerProps = {
  userKey: string;
  plans: StoredPlan[];
  /** Aktiver (gespielter) Slot; mobil wird nur dieser angezeigt. */
  slot: PlanSlotId;
};

function isPlayableJob(job: Pick<Job, "type">) {
  return job.type !== "custom" && job.type !== "trade" && job.type !== "snapshot";
}

/** Reduzierter Planer fürs Handy: nur nächste Aktion und kompakter Auftragsplan des aktiven Plans. */
export function MobilePlanner({ userKey, plans, slot }: MobilePlannerProps) {
  const current = plans.find((item) => item.slot === slot) ?? plans[0];
  const { now, today, startCfg, currentTick, plan, actionTicks, nextAction } = usePlanSimulation(current);
  const savePlan = useSavePlan(userKey, current.slot);

  const nextJobs = nextAction?.started.filter(isPlayableJob) ?? [];
  const followingAction =
    plan && nextAction ? (plan.ticks.find((tick) => tick.tick > nextAction.tick && tick.started.some(isPlayableJob)) ?? null) : null;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{planSlotLabel(current.slot)}</span>
            <span className="font-heading text-lg font-semibold tabular-nums">
              Tick {currentTick < 0 ? `−${Math.abs(currentTick)}` : currentTick}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{formatWallClock(now)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <TaxesDialog taxes={startCfg.taxes} currentTick={currentTick} onApply={(taxes) => savePlan({ taxes })} />
            <SettingsDialog
              settings={current.settings}
              roundEndTick={startCfg.round_end_tick}
              onApply={(settings) => savePlan({ settings })}
            />
          </div>
        </div>

        <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
          <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Nächste Aktion</span>
          {!plan ? (
            <Badge variant="destructive">Plan nicht berechenbar</Badge>
          ) : nextAction && nextJobs.length > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-xl font-semibold tabular-nums">T{nextAction.tick}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {nextAction.clockLabel} · <span className="text-foreground">{formatTimeUntilTick(startCfg, nextAction.tick, now)}</span>
                </span>
              </div>
              <div className="text-sm">
                <JobList items={nextJobs} />
              </div>
              {followingAction ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Danach: T{followingAction.tick} · {followingAction.clockLabel}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Keine weiteren Aktionen</span>
          )}
        </section>

        <div className="flex justify-end">
          <ResetPlanDialog
            destructive
            sources={planResetSources(current.slot)}
            onReset={(sourceId) => {
              const patch = planResetPatch(sourceId, plans, current.slot, today);
              if (patch) savePlan(patch);
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ActionPlan ticks={actionTicks} currentTick={currentTick} hasPlan={!!plan} isActive narrow />
      </div>
    </main>
  );
}
