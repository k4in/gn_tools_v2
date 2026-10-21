import { jobTypeClass } from "@/components/overview/actionplan.tsx";
import { ScrollArea } from "@/components/shadcn/scroll-area.tsx";
import { SidebarRow, SidebarSectionLabel } from "@/components/sidebar/sidebar-row.tsx";
import { StatusDot } from "@/components/sidebar/status-dot.tsx";
import { formatRes } from "@/lib/calculate-fastest-way-to-goal.ts";
import { type Defense } from "@/lib/gn-data/defense.ts";
import { type Ship } from "@/lib/gn-data/ships.ts";
import { type Utility } from "@/lib/gn-data/utility.ts";

export type UnitsProps = {
  ships: Ship[];
  defenses: Defense[];
  recon: Utility[];
  planned: Set<string>;
  /** Quereinstieg: keine „Voraussetzung fehlt“-Markierung. */
  ignoreMissingDeps?: boolean;
  onAdd: (name: string) => void;
  onAddRecon: (name: string) => void;
};

type Buildable = {
  name: string;
  ticks: number;
  cost: { met: number; kris: number };
  dependencies: string[];
};

function UnitRows({
  items,
  kind,
  planned,
  ignoreMissingDeps,
  onAdd,
}: {
  items: Buildable[];
  kind: "unit" | "recon";
  planned: Set<string>;
  ignoreMissingDeps: boolean;
  onAdd: (name: string) => void;
}) {
  return (
    <ul className="flex flex-col px-1.5">
      {items.map((item) => (
        <SidebarRow
          key={item.name}
          onClick={() => onAdd(item.name)}
          drag={{ item: { kind, name: item.name }, label: item.name }}
          titleClassName={jobTypeClass("unit")}
          title={
            <>
              {item.name}
              {!ignoreMissingDeps && item.dependencies.some((dep) => !planned.has(dep)) ? <StatusDot kind="blocked" /> : null}
            </>
          }
          meta={`${item.ticks} T · ${formatRes(item.cost.met)} M · ${formatRes(item.cost.kris)} K`}
        />
      ))}
    </ul>
  );
}

export function Units({ ships, defenses, recon, planned, ignoreMissingDeps = false, onAdd, onAddRecon }: UnitsProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="pb-2">
        <SidebarSectionLabel>Raumschiffe</SidebarSectionLabel>
        <UnitRows items={ships} kind="unit" planned={planned} ignoreMissingDeps={ignoreMissingDeps} onAdd={onAdd} />
        <SidebarSectionLabel>Geschütze</SidebarSectionLabel>
        <UnitRows items={defenses} kind="unit" planned={planned} ignoreMissingDeps={ignoreMissingDeps} onAdd={onAdd} />
        <SidebarSectionLabel>Aufklärung</SidebarSectionLabel>
        <UnitRows items={recon} kind="recon" planned={planned} ignoreMissingDeps={ignoreMissingDeps} onAdd={onAddRecon} />
      </div>
    </ScrollArea>
  );
}
