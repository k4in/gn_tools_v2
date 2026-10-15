import { memo, useRef, type ReactNode } from "react";
import { useScrollIntoViewWhenActive } from "@/hooks/useScrollIntoViewWhenActive.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shadcn/table.tsx";
import {
  formatCatastropheLossLabel,
  formatRes,
  formatRoidLootLabel,
  type JobKind,
  type NamedJob,
  type TickSnapshot,
} from "@/lib/calculate-fastest-way-to-goal.ts";
import { StatusDot } from "@/components/sidebar/status-dot.tsx";
import { cn } from "@/lib/utils/cn.ts";

export type DisplayJob = {
  name: string;
  type: JobKind;
  suffix?: string;
  cost?: { met: number; kris: number };
  delayed?: boolean;
};

function formatCustomCost(cost: { met: number; kris: number }) {
  const parts: string[] = [];
  if (cost.met > 0) parts.push(`−${formatRes(cost.met)} M`);
  if (cost.kris > 0) parts.push(`−${formatRes(cost.kris)} K`);
  return parts.join(" · ");
}

export function jobTypeClass(type: JobKind) {
  if (type === "building") return "text-amber-500";
  if (type === "research") return "text-fuchsia-500";
  if (type === "unit" || type === "recon") return "text-emerald-400";
  if (type === "custom") return "text-silver-500";
  if (type === "trade") return "text-zinc-400";
  if (type === "roid") return "text-blue-400";
  if (type === "catastrophe") return "text-red-400";
  if (type === "attack") return "text-blue-300";
  if (type === "snapshot") return "text-foreground";
  return "text-sky-500";
}

/** Asteroiden/Extraktoren pro Tick zusammenfassen statt einzeln zu listen. */
export function collapseEconomyJobs(items: DisplayJob[]): DisplayJob[] {
  let asteroids = 0;
  let extractorsMet = 0;
  let extractorsKris = 0;
  let extractorsGeneric = 0;
  const rest: DisplayJob[] = [];

  for (const item of items) {
    if (item.type === "economy" && item.name.startsWith("Asteroid scannen")) {
      asteroids += 1;
      continue;
    }
    if (item.type === "economy" && item.name.startsWith("Extraktor (Metall)")) {
      extractorsMet += 1;
      continue;
    }
    if (item.type === "economy" && item.name.startsWith("Extraktor (Kristall)")) {
      extractorsKris += 1;
      continue;
    }
    if (item.type === "economy" && /^Extraktor\b/.test(item.name)) {
      extractorsGeneric += 1;
      continue;
    }
    // Already batched unit/recon labels pass through as-is
    rest.push(item);
  }

  const out: DisplayJob[] = [];
  if (asteroids > 0) {
    out.push({
      name: asteroids === 1 ? "1 Asteroid scannen" : `${asteroids} Asteroiden scannen`,
      type: "economy",
    });
  }
  if (extractorsMet > 0) {
    out.push({
      name: extractorsMet === 1 ? "1 Metallextraktor bauen" : `${extractorsMet} Metallextraktoren bauen`,
      type: "economy",
    });
  }
  if (extractorsKris > 0) {
    out.push({
      name: extractorsKris === 1 ? "1 Kristallextraktor bauen" : `${extractorsKris} Kristallextraktoren bauen`,
      type: "economy",
    });
  }
  if (extractorsGeneric > 0) {
    out.push({
      name: extractorsGeneric === 1 ? "1 Extraktor bauen" : `${extractorsGeneric} Extraktoren bauen`,
      type: "economy",
    });
  }
  return [...out, ...rest];
}

function withoutCustom(items: DisplayJob[]) {
  return items.filter((item) => item.type !== "custom" && item.type !== "trade" && item.type !== "snapshot");
}

function onlyCustom(items: DisplayJob[]) {
  return items.filter((item) => item.type === "custom" || item.type === "trade" || item.type === "snapshot");
}

export function ExtraEvents({ customs, tick }: { customs: NamedJob[]; tick: TickSnapshot }) {
  const hasQuests = tick.quests.length > 0;
  const hasRoids = tick.roidLoot.length > 0;
  const hasCatastrophe = tick.catastropheLoss.length > 0;
  const hasCustom = customs.length > 0;
  if (!hasQuests && !hasRoids && !hasCatastrophe && !hasCustom) return null;

  const parts: ReactNode[] = [];
  if (hasCustom) parts.push(<JobList key="custom" items={customs} />);
  if (hasQuests) {
    parts.push(
      <span key="quests" className="text-green-500">
        {tick.quests.map((q, i) => (
          <span key={q.id}>
            {i > 0 && <span className="text-muted-foreground">, </span>}
            {q.label}
          </span>
        ))}
      </span>
    );
  }
  tick.roidLoot.forEach((loot, i) => {
    const label = formatRoidLootLabel(loot);
    if (!label) return;
    parts.push(
      <span key={`${loot.planEntryId}-${i}`} className="text-blue-400">
        {label}
      </span>
    );
  });
  tick.catastropheLoss.forEach((loss, i) => {
    const label = formatCatastropheLossLabel(loss);
    if (!label) return;
    parts.push(
      <span key={`cat-${loss.planEntryId}-${i}`} className="text-red-400">
        {label}
      </span>
    );
  });

  return (
    <span className="inline">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground">, </span>}
          {part}
        </span>
      ))}
    </span>
  );
}

export function JobList({ items }: { items: DisplayJob[] }) {
  const collapsed = collapseEconomyJobs(items);
  return (
    <span className="inline">
      {collapsed.map((item, i) => {
        const customCost = item.type === "custom" && item.cost ? formatCustomCost(item.cost) : "";
        const extra = customCost || item.suffix;
        return (
          <span key={`${item.name}-${i}`}>
            {i > 0 && <span className="text-muted-foreground">, </span>}
            <span className={jobTypeClass(item.type)}>
              {item.name}
              {item.delayed ? <StatusDot kind="delayed" /> : null}
              {extra ? <span className="text-muted-foreground"> {extra}</span> : null}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function deltaClass(n: number) {
  if (n > 0) return "text-green-500";
  if (n < 0) return "text-red-500";
  return "";
}

function formatDelta(n: number) {
  if (!n) return "—";
  return `${n > 0 ? "+" : ""}${formatRes(n)}`;
}

function TruncateCell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TableCell className={cn("max-w-0", className)}>
      <div className="truncate">{children}</div>
    </TableCell>
  );
}

function tickAtOrBefore(ticks: TickSnapshot[], target: number) {
  let best: number | null = null;
  for (const t of ticks) {
    if (t.tick > target) break;
    best = t.tick;
  }
  return best;
}

function tickAtOrAfter(ticks: TickSnapshot[], target: number) {
  return ticks.find((t) => t.tick >= target)?.tick ?? ticks.at(-1)?.tick ?? null;
}

/** Vollständiges Tick-Protokoll (Ressourcen + Aktiv/Start/Quest). Memoisiert, weil die Seite sekündlich neu rendert. */
export const TickTable = memo(function TickTable({
  ticks,
  currentTick,
  inspectTick = null,
  isActive = false,
}: {
  ticks: TickSnapshot[];
  currentTick: number;
  inspectTick?: number | null;
  isActive?: boolean;
}) {
  const currentRowRef = useRef<HTMLTableRowElement>(null);
  const nowTick = tickAtOrBefore(ticks, currentTick);
  const inspectRowTick = inspectTick != null ? tickAtOrBefore(ticks, inspectTick) : null;
  const scrollTick = inspectRowTick ?? nowTick;
  useScrollIntoViewWhenActive(isActive, currentRowRef, "center", "nearest", scrollTick);

  return (
    <Table className="table-fixed" containerClassName="h-full overflow-auto">
      <colgroup>
        <col className="w-14" />
        <col className="w-28" />
        <col className="w-18" />
        <col className="w-18" />
        <col className="w-14" />
        <col className="w-14" />
        <col />
        <col className="w-60" />
        <col className="w-60" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Tick</TableHead>
          <TableHead>Uhrzeit</TableHead>
          <TableHead className="text-right">Met</TableHead>
          <TableHead className="text-right">Kris</TableHead>
          <TableHead className="text-right">+M</TableHead>
          <TableHead className="text-right">+K</TableHead>
          <TableHead>Aktiv</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>Quest/Custom</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ticks.map((t) => {
          const isNow = nowTick !== null && t.tick === nowTick;
          const isInspect = inspectRowTick !== null && t.tick === inspectRowTick;
          return (
            <TableRow key={t.tick} ref={scrollTick === t.tick ? currentRowRef : undefined} className={cn(isNow && "bg-green-500/15")}>
              <TableCell className="tabular-nums">{t.tick}</TableCell>
              <TableCell className={cn("tabular-nums", isInspect && "text-primary")}>{t.clockLabel}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRes(t.met)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRes(t.kris)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", deltaClass(t.incomeMet))}>{formatDelta(t.incomeMet)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", deltaClass(t.incomeKris))}>{formatDelta(t.incomeKris)}</TableCell>
              <TruncateCell>
                {t.active.length ? (
                  <JobList
                    items={t.active.map((j) => ({
                      name: j.name,
                      type: j.type,
                      suffix: `(${j.remainingTicks})`,
                    }))}
                  />
                ) : (
                  "—"
                )}
              </TruncateCell>
              <TruncateCell>{withoutCustom(t.started).length ? <JobList items={withoutCustom(t.started)} /> : null}</TruncateCell>
              <TruncateCell>
                <ExtraEvents customs={onlyCustom(t.started)} tick={t} />
              </TruncateCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
});

export type ActionPlanProps = {
  ticks: TickSnapshot[];
  currentTick: number;
  inspectTick?: number | null;
  hasPlan: boolean;
  isActive?: boolean;
};

/** Kompakter Auftragsplan: Tick · Uhrzeit · Auftrag. Memoisiert, weil die Seite sekündlich neu rendert. */
export const ActionPlan = memo(function ActionPlan({ ticks, currentTick, inspectTick = null, hasPlan, isActive = false }: ActionPlanProps) {
  const currentRowRef = useRef<HTMLTableRowElement>(null);
  const nextTick = hasPlan ? (ticks.find((t) => t.tick >= currentTick && withoutCustom(t.started).length > 0)?.tick ?? null) : null;
  const inspectRowTick = hasPlan && inspectTick != null ? tickAtOrAfter(ticks, inspectTick) : null;
  const scrollTick = inspectRowTick ?? nextTick;
  useScrollIntoViewWhenActive(isActive, currentRowRef, "center", "nearest", scrollTick);

  if (!hasPlan) {
    return <p className="p-4 text-sm text-muted-foreground">Kein Plan berechenbar.</p>;
  }

  return (
    <Table containerClassName="h-full overflow-auto">
      <TableHeader>
        <TableRow>
          <TableHead>Tick</TableHead>
          <TableHead>Uhrzeit</TableHead>
          <TableHead>Auftrag</TableHead>
          <TableHead>Quest/Custom</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ticks.map((t) => {
          const isNext = nextTick !== null && t.tick === nextTick;
          const isInspect = inspectRowTick !== null && t.tick === inspectRowTick;
          const orders = withoutCustom(t.started);
          const extras = onlyCustom(t.started);
          return (
            <TableRow key={t.tick} ref={scrollTick === t.tick ? currentRowRef : undefined} className={cn(isNext && "bg-green-500/15")}>
              <TableCell>{t.tick}</TableCell>
              <TableCell className={cn(isInspect && "text-primary")}>{t.clockLabel}</TableCell>
              <TableCell>{orders.length ? <JobList items={orders} /> : "—"}</TableCell>
              <TableCell>
                <ExtraEvents customs={extras} tick={t} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
});
