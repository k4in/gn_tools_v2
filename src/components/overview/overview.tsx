import { useMemo, useState } from "react";
import { ExportPlanDialog } from "@/components/export-plan-dialog.tsx";
import { ImportPlanDialog } from "@/components/import-plan-dialog.tsx";
import { ResetPlanDialog, type ResetPlanSource } from "@/components/reset-plan-dialog.tsx";
import { TaxesDialog } from "@/components/taxes-dialog.tsx";
import { ActionPlan } from "@/components/overview/actionplan.tsx";
import { Protocol } from "@/components/overview/protocol.tsx";
import { Timeline, type TimelineProps } from "@/components/overview/timeline.tsx";
import { CircleDot, Crosshair, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/shadcn/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip.tsx";
import { Separator } from "@/components/shadcn/separator.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/tabs.tsx";
import { type ExtractorSlotShortage, type Job, type TaxSegment, type TickSnapshot } from "@/lib/calculate-fastest-way-to-goal.ts";
import { historyRangeStart, type HistoryWindow } from "@/lib/history-window.ts";

type OverviewTab = "compact" | "detailed";

export type OverviewProps = {
  actionTicks: TickSnapshot[];
  logTicks: TickSnapshot[];
  steps: Job[];
  maxTick: number;
  currentTick: number;
  historyWindow?: HistoryWindow;
  hasPlan: boolean;
  exportJson?: string;
  exportPlanSlot?: number;
  /** Ersetzt den Plan durch ein JSON; gibt bei Fehlern die Meldung zurück. */
  onImportPlan?: (json: string) => string | null;
  onEditJob?: (planEntryId: string | undefined) => void;
  slotShortage?: ExtractorSlotShortage | null;
  resetSources?: ResetPlanSource[];
  onResetPlan?: (sourceId: string) => void;
  taxes?: TaxSegment[];
  onAddSnapshot?: () => void;
  /** Quereinstieg: fehlende Voraussetzungen bei Einheiten und Wirtschaft ignorieren. */
  ignoreNonTechDeps?: boolean;
  onIgnoreNonTechDepsChange?: (next: boolean) => void;
  onApplyTaxes?: (taxes: TaxSegment[]) => void;
  isLivePlan?: boolean;
  onSetLivePlan?: () => void;
  inspectTick?: number | null;
  onInspectTick?: (tick: number) => void;
  /** Uhrzeit zu einem Tick, auch über das Simulationsende hinaus. */
  tickClock?: (tick: number) => string;
} & Pick<TimelineProps, "onMoveEntry" | "onDropItem" | "getEarliestTick">;

export function Overview({
  actionTicks,
  logTicks,
  steps,
  maxTick,
  currentTick,
  historyWindow = "recent",
  hasPlan,
  exportJson,
  exportPlanSlot,
  onImportPlan,
  onEditJob,
  slotShortage = null,
  resetSources,
  onResetPlan,
  taxes = [],
  onAddSnapshot,
  ignoreNonTechDeps = false,
  onIgnoreNonTechDepsChange,
  onApplyTaxes,
  isLivePlan = false,
  onSetLivePlan,
  inspectTick = null,
  onInspectTick,
  tickClock,
  onMoveEntry,
  onDropItem,
  getEarliestTick,
}: OverviewProps) {
  const [tab, setTab] = useState<OverviewTab>("detailed");
  const historyStart = historyRangeStart(currentTick, historyWindow);
  const visibleLogTicks = useMemo(
    () => (historyStart <= 0 ? logTicks : logTicks.filter((t) => t.tick >= historyStart)),
    [logTicks, historyStart]
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "compact" || value === "detailed") setTab(value);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <TabsList>
              <TabsTrigger value="compact">Kompakt</TabsTrigger>
              <TabsTrigger value="detailed">Detailliert</TabsTrigger>
            </TabsList>
            {onApplyTaxes && <TaxesDialog taxes={taxes} currentTick={currentTick} onApply={onApplyTaxes} />}
            {onAddSnapshot && (
              <Button type="button" variant="outline" onClick={onAddSnapshot}>
                <Crosshair data-icon="inline-start" />
                Stand setzen
              </Button>
            )}
            {onIgnoreNonTechDepsChange && (
              <Tooltip>
                <TooltipTrigger
                  // Der Tooltip bleibt beim Umschalten offen, damit die Erklärung zum neuen Zustand sichtbar ist.
                  closeOnClick={false}
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={ignoreNonTechDeps}
                      onClick={() => onIgnoreNonTechDepsChange(!ignoreNonTechDeps)}
                      className="aria-pressed:border-amber-500/60 aria-pressed:bg-amber-500/10 aria-pressed:text-amber-300 aria-pressed:hover:bg-amber-500/20"
                    />
                  }
                >
                  {ignoreNonTechDeps ? <Link2 data-icon="inline-start" /> : <Unlink data-icon="inline-start" />}
                  Quereinstieg
                </TooltipTrigger>
                <TooltipContent>
                  {ignoreNonTechDeps
                    ? "Aktiv: Fehlende Voraussetzungen bei Einheiten und Wirtschaft werden ignoriert. Gebäude und Forschung werden weiter geprüft."
                    : "Fehlende Voraussetzungen bei Einheiten und Wirtschaft ignorieren. Gebäude und Forschung werden weiter geprüft."}
                </TooltipContent>
              </Tooltip>
            )}
            {slotShortage && (
              <p role="alert" className="min-w-0 truncate text-xs text-destructive">
                Zu wenig Asteroidenplätze: {slotShortage.extractors} Extraktoren, aber nur {slotShortage.slots} Plätze (
                {slotShortage.asteroids} {slotShortage.asteroids === 1 ? "Asteroid" : "Asteroiden"}). {slotShortage.unslotted}{" "}
                {slotShortage.unslotted === 1 ? "Extraktor steht" : "Extraktoren stehen"} ohne Platz und{" "}
                {slotShortage.unslotted === 1 ? "liefert" : "liefern"} keine Rohstoffe
                {slotShortage.asteroidsNeeded > 0
                  ? ` — es ${
                      slotShortage.asteroidsNeeded === 1 ? "fehlt 1 Asteroid" : `fehlen ${slotShortage.asteroidsNeeded} Asteroiden`
                    }.`
                  : "."}
              </p>
            )}
          </div>
          {exportJson !== undefined && (
            <div className="flex shrink-0 items-center gap-1">
              {onSetLivePlan &&
                (isLivePlan ? (
                  <span className="inline-flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-green-500">
                    <span className="size-1.5 rounded-full bg-green-500" />
                    Aktiver Plan
                  </span>
                ) : (
                  <Button type="button" variant="ghost" onClick={onSetLivePlan}>
                    <CircleDot data-icon="inline-start" />
                    Als aktiv setzen
                  </Button>
                ))}
              <Separator orientation="vertical" className="mx-1 my-2" />
              {onImportPlan && <ImportPlanDialog onImport={onImportPlan} />}
              <ExportPlanDialog json={exportJson} planSlot={exportPlanSlot ?? 1} />
              {resetSources && onResetPlan && <ResetPlanDialog sources={resetSources} onReset={onResetPlan} />}
            </div>
          )}
        </div>

        <div className="shrink-0 border-b border-border">
          <Timeline
            steps={steps}
            ticks={logTicks}
            maxTick={maxTick}
            historyStartTick={historyStart}
            currentTick={currentTick}
            inspectTick={inspectTick}
            hasPlan={hasPlan}
            isActive
            onEditJob={onEditJob}
            onInspectTick={onInspectTick}
            tickClock={tickClock}
            onMoveEntry={onMoveEntry}
            onDropItem={onDropItem}
            getEarliestTick={getEarliestTick}
          />
        </div>

        <TabsContent value="compact" className="min-h-0 flex-1 overflow-hidden data-hidden:hidden">
          <ActionPlan
            ticks={actionTicks}
            currentTick={currentTick}
            inspectTick={inspectTick}
            hasPlan={hasPlan}
            isActive={tab === "compact"}
          />
        </TabsContent>

        <TabsContent value="detailed" className="min-h-0 flex-1 overflow-hidden data-hidden:hidden">
          {tab === "detailed" ? (
            <Protocol ticks={visibleLogTicks} currentTick={currentTick} inspectTick={inspectTick} hasPlan={hasPlan} isActive />
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
