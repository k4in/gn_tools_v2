import { memo, useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip.tsx";
import { StatusDot } from "@/components/sidebar/status-dot.tsx";
import { attackFirstCombatTick, type Job, type JobKind, type TickSnapshot } from "@/lib/calculate-fastest-way-to-goal.ts";
import { cn } from "@/lib/utils/cn.ts";

/** Sichtbare Breite der Timeline in Ticks (Viewport): 2 Tage bei 15-Minuten-Ticks. */
const TIMELINE_VIEWPORT_TICKS = 192;

export type TimelineProps = {
  steps: Job[];
  ticks?: TickSnapshot[];
  maxTick: number;
  /** Erstes sichtbares Tick (Vergangenheit davor wird nicht gezeichnet). */
  historyStartTick?: number;
  currentTick: number;
  inspectTick?: number | null;
  hasPlan: boolean;
  isActive?: boolean;
  onEditJob?: (planEntryId: string | undefined) => void;
  onInspectTick?: (tick: number) => void;
  /** Uhrzeit zu einem Tick; ohne wird die Uhrzeit aus den Snapshots genommen. */
  tickClock?: (tick: number) => string;
};

function snapshotAtOrBefore(ticks: TickSnapshot[] | undefined, tick: number) {
  if (!ticks?.length) return null;
  let best: TickSnapshot | null = null;
  for (const snap of ticks) {
    if (snap.tick > tick) break;
    best = snap;
  }
  return best;
}

function tickFromClick(el: HTMLElement, clientX: number, rangeStart: number, domainLength: number) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return rangeStart;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(rangeStart + ratio * domainLength);
}

type TimelineLane = "tech" | "fleet" | "econ" | "attack";

function laneOf(type: JobKind): TimelineLane {
  if (type === "building" || type === "research") return "tech";
  if (type === "unit" || type === "recon") return "fleet";
  // Alte Roid-Einträge liegen mit den Angriffsflügen in einer Zeile (rein optisch).
  if (type === "attack" || type === "roid") return "attack";
  return "econ";
}

function packRows(jobs: Job[]): Job[][] {
  const sorted = [...jobs].sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const rows: Job[][] = [];
  for (const job of sorted) {
    let placed = false;
    for (const row of rows) {
      const last = row[row.length - 1];
      const lastEnd = Math.max(last.endTick, last.startTick + (last.endTick === last.startTick ? 0.5 : 0));
      if (lastEnd <= job.startTick) {
        row.push(job);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([job]);
  }
  return rows;
}

// Memoisiert, weil die Seite sekündlich neu rendert; Callbacks müssen dafür stabil sein.
export const Timeline = memo(function Timeline({
  steps,
  ticks,
  maxTick,
  historyStartTick = 0,
  currentTick,
  inspectTick = null,
  hasPlan,
  isActive = false,
  onEditJob,
  onInspectTick,
  tickClock,
}: TimelineProps) {
  const xScrollRef = useRef<HTMLDivElement>(null);
  const rangeStart = Math.max(0, historyStartTick);
  const domainLength = Math.max(maxTick - rangeStart, TIMELINE_VIEWPORT_TICKS);
  const domainEnd = rangeStart + domainLength;

  useEffect(() => {
    if (!isActive) return;
    const total = domainLength;
    const tick = Math.min(Math.max(currentTick - rangeStart, 0), total);
    const id = requestAnimationFrame(() => {
      const scroller = xScrollRef.current;
      if (!scroller) return;
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      if (maxScroll <= 0) return;
      scroller.scrollLeft = Math.max(0, (tick / total) * scroller.scrollWidth - scroller.clientWidth / 2);
    });
    return () => cancelAnimationFrame(id);
    // Nur beim Öffnen des Tabs / Wechsel des Verlaufsfensters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, historyStartTick]);
  if (!hasPlan) {
    return <p className="p-4 text-sm text-muted-foreground">Kein Plan berechenbar.</p>;
  }

  // Group multi-unit/economy micro-jobs that share planEntryId into one bar
  const grouped = new Map<string, Job>();
  const economyParts = new Map<string, { asteroids: number; metExt: number; krisExt: number }>();
  for (const s of steps) {
    const key = s.planEntryId ?? `${s.name}@${s.startTick}`;
    if (s.type === "economy" && s.planEntryId) {
      const parts = economyParts.get(key) ?? { asteroids: 0, metExt: 0, krisExt: 0 };
      if (s.name.startsWith("Asteroid")) parts.asteroids += 1;
      else if (s.name.includes("Metall")) parts.metExt += 1;
      else if (s.name.includes("Kristall")) parts.krisExt += 1;
      economyParts.set(key, parts);
    }
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, { ...s });
      continue;
    }
    grouped.set(key, {
      ...prev,
      startTick: Math.min(prev.startTick, s.startTick),
      endTick: Math.max(prev.endTick, s.endTick),
      blocked: Boolean(prev.blocked || s.blocked),
      delayed: Boolean(prev.delayed || s.delayed),
      name: prev.planEntryId ? prev.name.replace(/ \(\d+\/\d+\)$/, "").replace(/ #\d+$/, "") : prev.name,
    });
  }
  for (const [key, parts] of economyParts) {
    const job = grouped.get(key);
    if (!job) continue;
    const labels: string[] = [];
    if (parts.asteroids > 0) {
      labels.push(parts.asteroids === 1 ? "1 Asteroid" : `${parts.asteroids} Asteroiden`);
    }
    if (parts.metExt > 0) {
      labels.push(parts.metExt === 1 ? "1 Met-Ext" : `${parts.metExt} Met-Ext`);
    }
    if (parts.krisExt > 0) {
      labels.push(parts.krisExt === 1 ? "1 Kris-Ext" : `${parts.krisExt} Kris-Ext`);
    }
    if (labels.length) job.name = labels.join(" + ");
  }

  const byLane: Record<TimelineLane, Job[]> = { tech: [], fleet: [], econ: [], attack: [] };
  for (const job of grouped.values()) {
    const displayEnd = job.endTick === job.startTick ? job.startTick + 0.5 : job.endTick;
    if (displayEnd <= rangeStart || job.startTick >= domainEnd) continue;
    byLane[laneOf(job.type)].push(job);
  }
  const laneRows = (["tech", "fleet", "econ", "attack"] as const).map((lane) => packRows(byLane[lane])).filter((rows) => rows.length > 0);

  const rowHeight = 32;
  const laneGap = 10;
  const packedRows: { jobs: Job[]; top: number }[] = [];
  const separators: number[] = [];
  let cursor = 4;
  laneRows.forEach((rows, laneIndex) => {
    if (laneIndex > 0) {
      separators.push(cursor - 4 + laneGap / 2);
      cursor += laneGap;
    }
    for (const jobs of rows) {
      packedRows.push({ jobs, top: cursor });
      cursor += rowHeight;
    }
  });
  const trackHeight = Math.max(cursor + 4, rowHeight + 8);
  const step = 10;
  // Randmarken nicht direkt neben eine Rastermarke setzen, sonst überlappen die Zahlen.
  const minGap = step / 2;
  const markers: number[] = [rangeStart];
  const firstStep = Math.ceil((rangeStart + 1) / step) * step;
  for (let t = firstStep; t < domainEnd; t += step) {
    if (t - rangeStart >= minGap && domainEnd - t >= minGap) markers.push(t);
  }
  if (markers[markers.length - 1] !== domainEnd) markers.push(domainEnd);
  // Skalenzahlen unter der Tick-/Inspektionsmarke ausblenden, sonst überlappen sie.
  const highlighted = [currentTick, inspectTick].filter((t): t is number => t != null);
  const axisLabels = markers.filter((t) => highlighted.every((h) => Math.abs(t - h) >= step * 0.4));
  function xPct(tick: number) {
    return ((tick - rangeStart) / domainLength) * 100;
  }

  return (
    <div ref={xScrollRef} className="overflow-x-auto px-3 pt-3 pb-2">
      <div
        className="relative cursor-crosshair"
        style={{
          width: `calc(100% * ${domainLength} / ${TIMELINE_VIEWPORT_TICKS})`,
        }}
        onClick={(event) => {
          if (!onInspectTick) return;
          onInspectTick(tickFromClick(event.currentTarget, event.clientX, rangeStart, domainLength));
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: trackHeight }}>
          {markers.map((t) => (
            <div key={`grid-${t}`} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${xPct(t)}%` }} />
          ))}
          {currentTick >= rangeStart && currentTick <= domainEnd && (
            <div
              title={`Aktueller Tick ${currentTick}`}
              className="absolute inset-y-0 z-10 w-0.5 bg-green-500"
              style={{ left: `${xPct(currentTick)}%` }}
            />
          )}
          {inspectTick != null && inspectTick >= rangeStart && inspectTick <= domainEnd && (
            <div
              title={`Inspektion Tick ${inspectTick}`}
              className="absolute inset-y-0 z-10 w-0.5 bg-primary"
              style={{ left: `${xPct(inspectTick)}%` }}
            />
          )}
          {separators.map((top) => (
            <div key={`lane-${top}`} className="absolute inset-x-0 h-px bg-border" style={{ top }} />
          ))}
        </div>

        <div className="relative" style={{ height: trackHeight }}>
          {packedRows.map((row) =>
            row.jobs.map((s) => {
              const start = Math.max(rangeStart, Math.min(s.startTick, domainEnd));
              const displayEnd = s.endTick === s.startTick ? s.startTick + 0.5 : s.endTick;
              const endClamped = Math.max(start, Math.min(displayEnd, domainEnd));
              const left = xPct(start);
              const widthPct = Math.max(((endClamped - start) / domainLength) * 100, 0.25);
              const isBuilding = s.type === "building";
              const isResearch = s.type === "research";
              const top = row.top;
              const clickable = !!s.planEntryId && !!onEditJob;
              function clockAt(tick: number) {
                return tickClock ? tickClock(tick) : snapshotAtOrBefore(ticks, tick)?.clockLabel;
              }
              const startClock = clockAt(s.startTick);
              const endClock = s.endTick === s.startTick ? startClock : clockAt(s.endTick);
              // Kampfphase relativ zum (ggf. abgeschnittenen) Balken einfärben:
              // dunkelblau = Flottenkampf, hellblau = Roid (immer die letzten Kampfticks).
              const barTicks = Math.max(endClamped - start, 1);
              function band(from: number, to: number) {
                const a = Math.max(start, Math.min(from, endClamped));
                const b = Math.max(a, Math.min(to, endClamped));
                return b > a
                  ? {
                      left: ((a - start) / barTicks) * 100,
                      width: ((b - a) / barTicks) * 100,
                    }
                  : null;
              }
              const roidFrom = s.combat?.roidStartTick ?? s.combat?.endTick ?? 0;
              const fightBand = s.combat ? band(s.combat.startTick, roidFrom) : null;
              const roidBand = s.combat ? band(roidFrom, s.combat.endTick) : null;
              return (
                <Tooltip key={`${s.name}-${s.startTick}-${s.planEntryId ?? ""}`}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (clickable) onEditJob?.(s.planEntryId);
                        }}
                        className={cn(
                          "absolute overflow-hidden rounded-sm px-1.5 py-0.5 text-left text-[10px] leading-tight",
                          isBuilding && "bg-amber-500/20 text-amber-300",
                          isResearch && "bg-fuchsia-500/20 text-fuchsia-300",
                          (s.type === "unit" || s.type === "recon") && "bg-emerald-500/20 text-emerald-300",
                          s.type === "economy" && "bg-cyan-500/20 text-cyan-300",
                          s.type === "roid" && "bg-blue-800/35 text-blue-400",
                          s.type === "catastrophe" && "bg-red-800/35 text-red-400",
                          s.type === "attack" && "bg-zinc-900 text-zinc-300",
                          s.type === "snapshot" && "bg-foreground/10 text-foreground",
                          s.type === "custom" && "bg-silver-500/20 text-silver-500",
                          s.type === "trade" && "bg-zinc-500/20 text-zinc-400",
                          s.blocked
                            ? "ring-2 ring-destructive"
                            : cn(
                                "ring-1 ring-inset",
                                isBuilding && "ring-amber-500/40",
                                isResearch && "ring-fuchsia-500/40",
                                (s.type === "unit" || s.type === "recon") && "ring-emerald-500/40",
                                s.type === "economy" && "ring-cyan-500/40",
                                s.type === "roid" && "ring-blue-700/50",
                                s.type === "catastrophe" && "ring-red-700/50",
                                s.type === "attack" && "ring-blue-500",
                                s.type === "snapshot" && "ring-0 outline-1 -outline-offset-1 outline-foreground/50 outline-dashed",
                                s.type === "custom" && "ring-silver-500/40",
                                s.type === "trade" && "ring-zinc-500/40"
                              ),
                          clickable && "cursor-pointer hover:brightness-125",
                          !clickable && "cursor-default"
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${widthPct}%`,
                          top,
                          height: rowHeight - 8,
                        }}
                      />
                    }
                  >
                    {fightBand && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 bg-blue-700"
                        style={{ left: `${fightBand.left}%`, width: `${fightBand.width}%` }}
                      />
                    )}
                    {roidBand && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 bg-sky-400/70"
                        style={{ left: `${roidBand.left}%`, width: `${roidBand.width}%` }}
                      />
                    )}
                    <span className="relative flex min-w-0 items-center">
                      <span className="truncate font-medium">{s.name}</span>
                      {s.delayed ? <StatusDot kind="delayed" /> : null}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="flex-col items-start gap-0.5 text-left">
                    <span className="font-medium">{s.name}</span>
                    {s.endTick === s.startTick ? (
                      <span className="text-muted-foreground tabular-nums">
                        Tick {s.startTick}
                        {startClock ? ` – ${startClock}` : ""}
                      </span>
                    ) : (
                      <>
                        <span className="text-muted-foreground tabular-nums">
                          Start: Tick {s.startTick}
                          {startClock ? ` – ${startClock}` : ""}
                        </span>
                        {s.combat && (
                          <span className="text-blue-400 tabular-nums">
                            Kampf: Tick {attackFirstCombatTick(s.startTick)}–{s.combat.endTick}
                            {clockAt(attackFirstCombatTick(s.startTick))
                              ? ` – ${clockAt(attackFirstCombatTick(s.startTick))} bis ${clockAt(s.combat.endTick)}`
                              : ""}
                          </span>
                        )}
                        {s.combat?.roidStartTick != null && (
                          <span className="text-sky-400 tabular-nums">
                            Roid: Tick {s.combat.roidStartTick + 1}–{s.combat.endTick}
                            {clockAt(s.combat.roidStartTick + 1)
                              ? ` – ${clockAt(s.combat.roidStartTick + 1)} bis ${clockAt(s.combat.endTick)}`
                              : ""}
                          </span>
                        )}
                        <span className="text-muted-foreground tabular-nums">
                          Ende: Tick {s.endTick}
                          {endClock ? ` – ${endClock}` : ""}
                        </span>
                      </>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })
          )}
        </div>

        <div className="relative mt-1 h-4 border-t border-border pt-1">
          {axisLabels.map((t) => (
            <span
              key={t}
              className="absolute text-[10px] text-muted-foreground tabular-nums"
              style={{
                left: `${xPct(t)}%`,
                transform: t === rangeStart ? "none" : t === domainEnd ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {t}
            </span>
          ))}
          {currentTick >= rangeStart && currentTick <= domainEnd && (
            <span
              className="absolute z-10 text-[10px] text-green-500 tabular-nums"
              style={{
                left: `${xPct(currentTick)}%`,
                transform: currentTick === rangeStart ? "none" : currentTick === domainEnd ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {currentTick}
            </span>
          )}
          {inspectTick != null && inspectTick >= rangeStart && inspectTick <= domainEnd && (
            <span
              className="absolute z-10 text-[10px] text-primary tabular-nums"
              style={{
                left: `${xPct(inspectTick)}%`,
                transform: inspectTick === rangeStart ? "none" : inspectTick === domainEnd ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {inspectTick}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
