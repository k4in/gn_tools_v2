import { ExtractorsDialog } from "@/components/extractors-dialog.tsx";
import { JobList } from "@/components/overview/actionplan.tsx";
import { SettingsDialog } from "@/components/settings-dialog.tsx";
import { type ReactNode } from "react";
import { type PlanSettings } from "@/lib/utils/plan-data.ts";
import { Badge } from "@/components/shadcn/badge.tsx";
import { Separator } from "@/components/shadcn/separator.tsx";
import {
  clockLabel,
  formatRes,
  formatTimeUntilTick,
  formatWallClock,
  type PlanResult,
  type StartConfig,
  type TickSnapshot,
} from "@/lib/calculate-fastest-way-to-goal.ts";

export type HeaderProps = {
  now: Date;
  currentTick: number;
  startCfg: StartConfig;
  plan: PlanResult | null;
  nextAction: TickSnapshot | null;
  /** Einstellungen des angesehenen Plan-Slots. */
  settings: PlanSettings;
  onApplySettings: (next: PlanSettings) => void;
  planSwitcher?: ReactNode;
};

function resourcesAtCurrentTick(plan: PlanResult | null, startCfg: StartConfig, currentTick: number) {
  if (!plan || currentTick < 0) {
    return {
      met: startCfg.starting_resources.metall,
      kris: startCfg.starting_resources.kristall,
    };
  }
  let best: TickSnapshot | null = null;
  for (const tick of plan.ticks) {
    if (tick.tick > currentTick) break;
    best = tick;
  }
  if (!best) {
    return {
      met: startCfg.starting_resources.metall,
      kris: startCfg.starting_resources.kristall,
    };
  }
  return { met: best.met, kris: best.kris };
}

export function Header({ now, currentTick, startCfg, plan, nextAction, settings, onApplySettings, planSwitcher }: HeaderProps) {
  const extractorJob = plan?.steps.find((s) => s.name === "Extraktor");
  const extractorTick = extractorJob?.endTick;
  function isPlayableJob(job: { type: string }) {
    return job.type !== "custom" && job.type !== "trade" && job.type !== "snapshot";
  }
  const nextJobs = nextAction?.started.filter(isPlayableJob) ?? [];
  const followingAction =
    plan && nextAction ? (plan.ticks.find((tick) => tick.tick > nextAction.tick && tick.started.some(isPlayableJob)) ?? null) : null;
  const resources = resourcesAtCurrentTick(plan, startCfg, currentTick);

  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-stretch gap-0 px-4">
        <div className="flex shrink-0 items-center gap-5 py-3 pr-5">
          <div className="flex items-center gap-2">
            {planSwitcher}
            <SettingsDialog settings={settings} roundEndTick={startCfg.round_end_tick} onApply={onApplySettings} />
          </div>
          <Separator orientation="vertical" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Uhrzeit</span>
            <span className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-heading text-xl font-semibold tracking-tight">{formatWallClock(now).split(" ")[1]}</span>
              <span className="text-xs text-muted-foreground">{formatWallClock(now).split(" ")[0]}</span>
            </span>
          </div>
          <Separator orientation="vertical" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Tick</span>
            <span className="font-heading text-xl font-semibold tabular-nums">
              {currentTick < 0 ? `−${Math.abs(currentTick)}` : currentTick}
            </span>
          </div>
          {!plan && (
            <>
              <Separator orientation="vertical" />
              <Badge variant="destructive">Plan nicht berechenbar</Badge>
            </>
          )}
        </div>

        <Separator orientation="vertical" className="my-2" />

        <div className="flex min-w-0 flex-1 items-stretch gap-6 overflow-x-auto px-5 py-2">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Nächste Aktion</span>
            {nextAction && nextJobs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex shrink-0 items-baseline gap-2">
                  <span className="text-sm font-medium tabular-nums">T{nextAction.tick}</span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {nextAction.clockLabel} · <span className="text-foreground">{formatTimeUntilTick(startCfg, nextAction.tick, now)}</span>
                  </span>
                </div>
                <JobList items={nextJobs} />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Keine weiteren Aktionen</span>
            )}
          </div>

          <div className="flex shrink-0 flex-col justify-center gap-0.5">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Danach</span>
            {followingAction ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                T{followingAction.tick} · {followingAction.clockLabel}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>

          <div className="flex shrink-0 items-stretch gap-4">
            <Separator orientation="vertical" />
            <div className="flex min-w-28 flex-col justify-center gap-0.5">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Aktuelle Ressourcen</span>
              <span className="text-sm font-medium tabular-nums">
                {formatRes(resources.met)} M<span className="ml-1.5">{formatRes(resources.kris)} K</span>
              </span>
            </div>
            <Separator orientation="vertical" />
            <ExtractorsDialog startCfg={startCfg} plan={plan} currentTick={currentTick}>
              {extractorTick !== undefined && currentTick >= extractorTick ? (
                <span className="text-sm font-medium text-sky-500">Extraktoren</span>
              ) : (
                <>
                  <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Extraktoren</span>
                  {extractorTick !== undefined ? (
                    <span className="text-sm font-medium tabular-nums">
                      ab Tick {extractorTick}
                      <span className="ml-1.5 font-normal text-muted-foreground">{clockLabel(startCfg, extractorTick)}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">nicht im Plan</span>
                  )}
                </>
              )}
            </ExtractorsDialog>
          </div>
        </div>
      </div>
    </header>
  );
}
