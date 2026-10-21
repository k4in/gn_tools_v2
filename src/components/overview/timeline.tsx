import { Fragment, memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Feedback } from "@dnd-kit/dom";
import { useDragDropMonitor, useDraggable } from "@dnd-kit/react";
import { type NewPlanItem, type PlanDragData } from "@/types/plan-drag.ts";
import { attackFirstCombatTick, type Job, type JobKind, type TickSnapshot } from "@/lib/calculate-fastest-way-to-goal.ts";
import { cn } from "@/lib/utils/cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip.tsx";
import { StatusDot } from "@/components/sidebar/status-dot.tsx";

/** Sichtbare Breite der Timeline in Ticks (Viewport): 2 Tage bei 15-Minuten-Ticks. */
const TIMELINE_VIEWPORT_TICKS = 192;
/** Feste Breite für Sofort-Einträge (0 Ticks), damit sie lesbar und greifbar bleiben. */
const INSTANT_CHIP_PX = 84;
const ROW_HEIGHT = 32;
const LANE_GAP = 10;
/** Balken zeigen beim Ziehen kein eigenes Feedback, die Timeline zeichnet eine Vorschau. */
const NO_FEEDBACK = [Feedback.configure({ feedback: "none" })];

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
  /** Balken wurde auf einen neuen Start-Tick gezogen. */
  onMoveEntry?: (planEntryId: string, startTick: number) => void;
  /** Eintrag aus der Sidebar wurde auf einen Tick fallen gelassen. */
  onDropItem?: (item: NewPlanItem, tick: number) => void;
  /** Frühester sinnvoller Start für das gezogene Element, wird beim Ziehen markiert. */
  getEarliestTick?: (data: PlanDragData) => number | null;
};

type DragPreview = {
  data: PlanDragData;
  /** Neuer Start-Tick (verschieben) bzw. Tick unter dem Mauszeiger (neu). */
  tick: number;
  /** Mauszeiger über der Timeline: nur dann wird beim Loslassen übernommen. */
  over: boolean;
  earliest: number | null;
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

function isInstant(job: Job) {
  return job.endTick === job.startTick;
}

/** Packt Jobs überlappungsfrei in Zeilen; `displayEnd` ist das sichtbare Ende in Ticks. */
function packRows(jobs: Job[], displayEnd: (job: Job) => number): Job[][] {
  const sorted = [...jobs].sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const rows: Job[][] = [];
  for (const job of sorted) {
    const row = rows.find((candidate) => displayEnd(candidate[candidate.length - 1]!) <= job.startTick);
    if (row) row.push(job);
    else rows.push([job]);
  }
  return rows;
}

/** Fasst Teil-Jobs eines Plan-Eintrags (z. B. mehrere Exen) zu einem Balken zusammen. */
function groupJobs(steps: Job[]): Job[] {
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
      underfunded: Boolean(prev.underfunded || s.underfunded),
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
  return [...grouped.values()];
}

function barClass(job: Job) {
  const isBuilding = job.type === "building";
  const isResearch = job.type === "research";
  const isFleet = job.type === "unit" || job.type === "recon";
  return cn(
    isBuilding && "bg-amber-500/20 text-amber-300",
    isResearch && "bg-fuchsia-500/20 text-fuchsia-300",
    isFleet && "bg-emerald-500/20 text-emerald-300",
    job.type === "economy" && "bg-cyan-500/20 text-cyan-300",
    job.type === "roid" && "bg-blue-800/35 text-blue-400",
    job.type === "catastrophe" && "bg-red-800/35 text-red-400",
    job.type === "attack" && "bg-zinc-900 text-zinc-300",
    job.type === "snapshot" && "bg-foreground/10 text-foreground",
    job.type === "custom" && "bg-silver-500/20 text-silver-500",
    job.type === "trade" && "bg-zinc-500/20 text-zinc-400",
    job.blocked || job.underfunded
      ? "ring-2 ring-destructive"
      : cn(
          "ring-1 ring-inset",
          isBuilding && "ring-amber-500/40",
          isResearch && "ring-fuchsia-500/40",
          isFleet && "ring-emerald-500/40",
          job.type === "economy" && "ring-cyan-500/40",
          job.type === "roid" && "ring-blue-700/50",
          job.type === "catastrophe" && "ring-red-700/50",
          job.type === "attack" && "ring-blue-500",
          job.type === "snapshot" && "ring-0 outline-1 -outline-offset-1 outline-foreground/50 outline-dashed",
          job.type === "custom" && "ring-silver-500/40",
          job.type === "trade" && "ring-zinc-500/40"
        ),
    // Sofort-Einträge: linke Kante markiert den Tick.
    isInstant(job) && "rounded-l-none border-l-2 border-current"
  );
}

type TimelineBarProps = {
  job: Job;
  style: CSSProperties;
  /** Kampfphasen relativ zum Balken in Prozent. */
  fightBand: { left: number; width: number } | null;
  roidBand: { left: number; width: number } | null;
  tooltip: ReactNode;
  draggable: boolean;
  /** Während irgendeines Drags keine Tooltips zeigen. */
  dragActive: boolean;
  onEdit?: (planEntryId: string | undefined) => void;
};

function TimelineBar({ job, style, fightBand, roidBand, tooltip, draggable, dragActive, onEdit }: TimelineBarProps) {
  const planEntryId = job.planEntryId;
  const data: PlanDragData | undefined = planEntryId
    ? { source: "timeline", planEntryId, startTick: job.startTick, label: job.name }
    : undefined;
  const { ref, isDragSource } = useDraggable<PlanDragData>({
    id: `timeline:${planEntryId ?? `${job.name}@${job.startTick}`}`,
    data,
    disabled: !draggable || !data,
    plugins: NO_FEEDBACK,
  });
  const clickable = !!planEntryId && !!onEdit;

  return (
    <Tooltip disabled={dragActive}>
      <TooltipTrigger
        render={
          <button
            ref={ref}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (clickable) onEdit?.(planEntryId);
            }}
            className={cn(
              "absolute overflow-hidden rounded-sm px-1.5 py-0.5 text-left text-[10px] leading-tight",
              barClass(job),
              clickable && "hover:brightness-125",
              draggable && data ? "cursor-grab touch-none" : clickable ? "cursor-pointer" : "cursor-default",
              isDragSource && "opacity-40"
            )}
            style={style}
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
          <span className="truncate font-medium">{job.name}</span>
          {job.underfunded ? <StatusDot kind="underfunded" /> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start gap-0.5 text-left">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
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
  onMoveEntry,
  onDropItem,
  getEarliestTick,
}: TimelineProps) {
  const xScrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  /** Tick unter dem Mauszeiger beim Drag-Start; Verschieben rechnet relativ dazu (auch beim Auto-Scroll). */
  const dragOriginTickRef = useRef(0);
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

  // Pixel pro Tick bestimmen die Breite der Sofort-Chips in Ticks (für das Packen der Zeilen).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackWidth(entry.contentRect.width);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [hasPlan]);

  /** Tick (mit Nachkommastellen) unter einer Bildschirm-X-Koordinate. */
  function tickAtClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return rangeStart;
    return rangeStart + ((clientX - rect.left) / rect.width) * domainLength;
  }

  function isOverTimeline({ x, y }: { x: number; y: number }) {
    const rect = xScrollRef.current?.getBoundingClientRect();
    return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function previewTick(data: PlanDragData, clientX: number) {
    if (data.source === "timeline") {
      return Math.max(0, Math.round(data.startTick + tickAtClientX(clientX) - dragOriginTickRef.current));
    }
    return Math.max(0, Math.floor(tickAtClientX(clientX)));
  }

  useDragDropMonitor<PlanDragData>({
    onDragStart(event) {
      const data = event.operation.source?.data;
      if (!data) return;
      const position = event.operation.position.current;
      dragOriginTickRef.current = tickAtClientX(position.x);
      setDrag({
        data,
        tick: previewTick(data, position.x),
        over: isOverTimeline(position),
        earliest: getEarliestTick?.(data) ?? null,
      });
    },
    onDragMove(event) {
      const data = event.operation.source?.data;
      if (!data) return;
      const position = event.operation.position.current;
      const tick = previewTick(data, position.x);
      const over = isOverTimeline(position);
      setDrag((prev) => (prev && prev.tick === tick && prev.over === over ? prev : { ...(prev ?? { data, earliest: null }), tick, over }));
    },
    onDragEnd(event) {
      const data = event.operation.source?.data;
      setDrag(null);
      if (!data || event.canceled) return;
      const position = event.operation.position.current;
      if (!isOverTimeline(position)) return;
      const tick = previewTick(data, position.x);
      if (data.source === "timeline") {
        if (tick !== data.startTick) onMoveEntry?.(data.planEntryId, tick);
      } else {
        onDropItem?.(data.item, tick);
      }
    },
  });

  if (!hasPlan) {
    return <p className="p-4 text-sm text-muted-foreground">Kein Plan berechenbar.</p>;
  }

  const pxPerTick = trackWidth > 0 ? trackWidth / domainLength : 0;
  const instantTicks = pxPerTick > 0 ? INSTANT_CHIP_PX / pxPerTick : 0.5;
  function displayEnd(job: Job) {
    return isInstant(job) ? job.startTick + instantTicks : job.endTick;
  }

  const byLane: Record<TimelineLane, Job[]> = { tech: [], fleet: [], econ: [], attack: [] };
  for (const job of groupJobs(steps)) {
    if (displayEnd(job) <= rangeStart || job.startTick >= domainEnd) continue;
    byLane[laneOf(job.type)].push(job);
  }
  const laneRows = (["tech", "fleet", "econ", "attack"] as const)
    .map((lane) => packRows(byLane[lane], displayEnd))
    .filter((rows) => rows.length > 0);

  const packedRows: { jobs: Job[]; top: number }[] = [];
  const separators: number[] = [];
  let cursor = 4;
  laneRows.forEach((rows, laneIndex) => {
    if (laneIndex > 0) {
      separators.push(cursor - 4 + LANE_GAP / 2);
      cursor += LANE_GAP;
    }
    for (const jobs of rows) {
      packedRows.push({ jobs, top: cursor });
      cursor += ROW_HEIGHT;
    }
  });
  const trackHeight = Math.max(cursor + 4, ROW_HEIGHT + 8);
  const step = 10;
  // Randmarken nicht direkt neben eine Rastermarke setzen, sonst überlappen die Zahlen.
  const minGap = step / 2;
  const markers: number[] = [rangeStart];
  const firstStep = Math.ceil((rangeStart + 1) / step) * step;
  for (let t = firstStep; t < domainEnd; t += step) {
    if (t - rangeStart >= minGap && domainEnd - t >= minGap) markers.push(t);
  }
  if (markers[markers.length - 1] !== domainEnd) markers.push(domainEnd);
  const dragTick = drag?.over ? drag.tick : null;
  // Skalenzahlen unter der Tick-/Inspektions-/Drag-Marke ausblenden, sonst überlappen sie.
  const highlighted = [currentTick, inspectTick, dragTick].filter((t): t is number => t != null);
  const axisLabels = markers.filter((t) => highlighted.every((h) => Math.abs(t - h) >= step * 0.4));
  function xPct(tick: number) {
    return ((tick - rangeStart) / domainLength) * 100;
  }
  function clockAt(tick: number) {
    return tickClock ? tickClock(tick) : snapshotAtOrBefore(ticks, tick)?.clockLabel;
  }
  function axisTransform(tick: number) {
    return tick === rangeStart ? "none" : tick === domainEnd ? "translateX(-100%)" : "translateX(-50%)";
  }
  const canMove = !!onMoveEntry;
  const dragActive = drag !== null;

  function jobTooltip(s: Job) {
    const startClock = clockAt(s.startTick);
    const endClock = s.endTick === s.startTick ? startClock : clockAt(s.endTick);
    return (
      <>
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
                {clockAt(s.combat.roidStartTick + 1) ? ` – ${clockAt(s.combat.roidStartTick + 1)} bis ${clockAt(s.combat.endTick)}` : ""}
              </span>
            )}
            <span className="text-muted-foreground tabular-nums">
              Ende: Tick {s.endTick}
              {endClock ? ` – ${endClock}` : ""}
            </span>
          </>
        )}
        {s.underfunded && <span className="text-destructive">Rohstoffe reichen nicht – Konto wird negativ</span>}
        {s.blocked && <span className="text-destructive">Voraussetzungen fehlen</span>}
        {canMove && s.planEntryId && <span className="text-muted-foreground">Ziehen zum Verschieben, Klicken zum Bearbeiten</span>}
      </>
    );
  }

  return (
    <div ref={xScrollRef} className="overflow-x-auto px-3 pt-3 pb-2">
      <div
        ref={trackRef}
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
          {drag?.over && drag.earliest != null && drag.earliest >= rangeStart && drag.earliest <= domainEnd && (
            <div
              className="absolute inset-y-0 z-10 border-l-2 border-dashed border-amber-400/80"
              style={{ left: `${xPct(drag.earliest)}%` }}
            >
              <span className="absolute top-0 left-1 rounded-sm bg-background/90 px-1 text-[10px] whitespace-nowrap text-amber-300">
                frühestens {drag.earliest}
              </span>
            </div>
          )}
          {dragTick != null && dragTick >= rangeStart && dragTick <= domainEnd && (
            <div className="absolute inset-y-0 z-20 w-0.5 bg-primary/80" style={{ left: `${xPct(dragTick)}%` }} />
          )}
        </div>

        <div className="relative" style={{ height: trackHeight }}>
          {packedRows.map((row) =>
            row.jobs.map((s) => {
              const start = Math.max(rangeStart, Math.min(s.startTick, domainEnd));
              const endClamped = Math.max(start, Math.min(isInstant(s) ? s.startTick + 0.5 : s.endTick, domainEnd));
              const width = isInstant(s) ? `${INSTANT_CHIP_PX}px` : `${Math.max(((endClamped - start) / domainLength) * 100, 0.25)}%`;
              const style = { width, top: row.top, height: ROW_HEIGHT - 8 };
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
              const isMoving = dragTick != null && drag?.data.source === "timeline" && drag.data.planEntryId === s.planEntryId;
              return (
                <Fragment key={`${s.name}-${s.startTick}-${s.planEntryId ?? ""}`}>
                  <TimelineBar
                    job={s}
                    style={{ ...style, left: `${xPct(start)}%` }}
                    fightBand={fightBand}
                    roidBand={roidBand}
                    tooltip={jobTooltip(s)}
                    draggable={canMove}
                    dragActive={dragActive}
                    onEdit={onEditJob}
                  />
                  {isMoving && (
                    // Vorschau an der neuen Position; der Balken selbst bleibt bis zum Loslassen stehen.
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute z-20 overflow-hidden rounded-sm px-1.5 py-0.5 text-[10px] leading-tight opacity-90 outline-2 outline-primary outline-dashed",
                        barClass(s)
                      )}
                      style={{ ...style, left: `${xPct(dragTick)}%` }}
                    >
                      <span className="block truncate font-medium">{s.name}</span>
                    </div>
                  )}
                </Fragment>
              );
            })
          )}
        </div>

        <div className="relative mt-1 h-4 border-t border-border pt-1">
          {axisLabels.map((t) => (
            <span
              key={t}
              className="absolute text-[10px] text-muted-foreground tabular-nums"
              style={{ left: `${xPct(t)}%`, transform: axisTransform(t) }}
            >
              {t}
            </span>
          ))}
          {currentTick >= rangeStart && currentTick <= domainEnd && (
            <span
              className="absolute z-10 text-[10px] text-green-500 tabular-nums"
              style={{ left: `${xPct(currentTick)}%`, transform: axisTransform(currentTick) }}
            >
              {currentTick}
            </span>
          )}
          {inspectTick != null && inspectTick >= rangeStart && inspectTick <= domainEnd && (
            <span
              className="absolute z-10 text-[10px] text-primary tabular-nums"
              style={{ left: `${xPct(inspectTick)}%`, transform: axisTransform(inspectTick) }}
            >
              {inspectTick}
            </span>
          )}
          {dragTick != null && dragTick >= rangeStart && dragTick <= domainEnd && (
            <span
              className="absolute z-20 rounded-sm bg-primary px-1 text-[10px] whitespace-nowrap text-primary-foreground tabular-nums"
              style={{ left: `${xPct(dragTick)}%`, transform: axisTransform(dragTick) }}
            >
              {dragTick}
              {clockAt(dragTick) ? ` · ${clockAt(dragTick)}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
