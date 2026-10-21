import { jobTypeClass } from "@/components/overview/actionplan.tsx";
import { StatusDot } from "@/components/sidebar/status-dot.tsx";
import { type JobKind } from "@/lib/calculate-fastest-way-to-goal.ts";
import { cn } from "@/lib/utils/cn.ts";

const TYPES: { type: JobKind; label: string }[] = [
  { type: "building", label: "Gebäude" },
  { type: "research", label: "Forschung" },
  { type: "unit", label: "Einheit" },
  { type: "economy", label: "Extraktoren" },
  { type: "roid", label: "Roid" },
  { type: "catastrophe", label: "Katastrophe" },
  { type: "attack", label: "Angriffsflug" },
  { type: "trade", label: "Trade/Custom" },
  { type: "snapshot", label: "Stand" },
];

/** Farb- und Punkt-Legende für Sidebar, Timeline und Tabellen. */
export function Legend() {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5 text-[11px] text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {TYPES.map(({ type, label }) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-[2px]",
                // Angriffsflug: dunkles Grau mit blauem Rand wie in der Timeline.
                type === "attack" ? "bg-zinc-900 ring-1 ring-blue-500" : cn("bg-current", jobTypeClass(type))
              )}
            />
            {label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {(
          [
            ["needed", "benötigt"],
            ["blocked", "Voraussetzung fehlt"],
            ["underfunded", "Rohstoffe fehlen"],
          ] as const
        ).map(([kind, label]) => (
          <span key={kind} className="inline-flex items-center gap-1">
            <span className="-ml-1 inline-flex">
              <StatusDot kind={kind} />
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
