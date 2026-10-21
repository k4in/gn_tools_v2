import { jobTypeClass } from "@/components/overview/actionplan.tsx";
import { ScrollArea } from "@/components/shadcn/scroll-area.tsx";
import { SidebarRow, SidebarSectionLabel } from "@/components/sidebar/sidebar-row.tsx";
import { StatusDot } from "@/components/sidebar/status-dot.tsx";

export type EconomyProps = {
  hasObservatorium: boolean;
  hasExtraktorTech: boolean;
  attackBlocked?: boolean;
  hasInterstellarerHandel: boolean;
  /** Quereinstieg: keine „Voraussetzung fehlt“-Markierung. */
  ignoreMissingDeps?: boolean;
  onAddEconomy: (preset?: { asteroids?: number; extractorsMet?: number; extractorsKris?: number }) => void;
  onAddCatastrophe: () => void;
  onAddAttack: () => void;
  onAddCustom: () => void;
  onAddTrade: () => void;
};

/** Extraktoren, Angriffe und freie Posten (Handel, Custom) in einem Tab. */
export function Economy({
  hasObservatorium,
  hasExtraktorTech,
  attackBlocked = false,
  hasInterstellarerHandel,
  ignoreMissingDeps = false,
  onAddEconomy,
  onAddCatastrophe,
  onAddAttack,
  onAddCustom,
  onAddTrade,
}: EconomyProps) {
  const economyBlocked = !ignoreMissingDeps && !hasObservatorium && !hasExtraktorTech;
  const showAttackBlocked = !ignoreMissingDeps && attackBlocked;
  const tradeBlocked = !ignoreMissingDeps && !hasInterstellarerHandel;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="pb-2">
        <SidebarSectionLabel>Extraktoren</SidebarSectionLabel>
        <ul className="flex flex-col px-1.5">
          <SidebarRow
            onClick={() => onAddEconomy()}
            drag={{ item: { kind: "economy" }, label: "Asteroiden & Extraktoren" }}
            titleClassName={jobTypeClass("economy")}
            title={
              <>
                Asteroiden & Extraktoren
                {economyBlocked ? <StatusDot kind="blocked" /> : null}
              </>
            }
            meta="Asteroiden scannen und/oder Exen bauen"
          />
          <SidebarRow
            onClick={onAddAttack}
            drag={{ item: { kind: "attack" }, label: "Angriffsflug" }}
            titleClassName={jobTypeClass("attack")}
            title={
              <>
                Angriffsflug
                {showAttackBlocked ? <StatusDot kind="blocked" /> : null}
              </>
            }
            meta="Extraktoren erbeuten in 1–10 Ticks"
          />
          <SidebarRow
            onClick={onAddCatastrophe}
            drag={{ item: { kind: "catastrophe" }, label: "Katastrophe" }}
            tone="destructive"
            titleClassName={jobTypeClass("catastrophe")}
            title="Katastrophe"
            meta="Extraktorenverlust bei Angriff"
          />
        </ul>
        <SidebarSectionLabel>Handel & Sonstiges</SidebarSectionLabel>
        <ul className="flex flex-col px-1.5">
          <SidebarRow
            onClick={onAddTrade}
            drag={{ item: { kind: "trade" }, label: "Trade" }}
            titleClassName={jobTypeClass("trade")}
            title={
              <>
                Trade
                {tradeBlocked ? <StatusDot kind="blocked" /> : null}
              </>
            }
            meta="Rohstoffe mit Spielern oder Galaxie tauschen"
          />
          <SidebarRow
            onClick={onAddCustom}
            drag={{ item: { kind: "custom" }, label: "Custom-Ausgabe" }}
            titleClassName={jobTypeClass("custom")}
            title="Custom-Ausgabe"
            meta="Beliebige Kosten mit eigenem Label"
          />
        </ul>
      </div>
    </ScrollArea>
  );
}
