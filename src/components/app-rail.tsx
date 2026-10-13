import { type ComponentType } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { CalendarClock, ChartColumn, Radar, Swords } from "lucide-react";
import { AccountDialog } from "@/components/auth/account-dialog.tsx";
import { InfoDialog } from "@/components/info-dialog.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip.tsx";
import { cn } from "@/lib/utils/cn.ts";

type RailTool = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  to: LinkProps["to"];
};

const TOOLS: RailTool[] = [
  { label: "Planer", icon: CalendarClock, to: "/" },
  { label: "Scan-Auswertung", icon: Radar, to: "/scan" },
  { label: "Lohnt sich der Angriff?", icon: Swords, to: "/angriff" },
  { label: "Kampfwerte-Matrix", icon: ChartColumn, to: "/kampfwerte" },
];

const ITEM_CLASS =
  "relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

type AppRailProps = {
  userKey: string;
  userName: string;
};

/** App-weite Tool-Navigation: Leiste links, mobil oben. */
export function AppRail({ userKey, userName }: AppRailProps) {
  return (
    <nav
      aria-label="Tools"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-3 max-md:h-14 max-md:w-full max-md:flex-row max-md:border-r-0 max-md:border-b max-md:px-3 max-md:py-0"
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        return (
          <Tooltip key={tool.label}>
            <TooltipTrigger
              render={
                <Link
                  to={tool.to}
                  aria-label={tool.label}
                  // Unterseiten (z. B. /scan/news) markieren ihr Tool mit; nur „/“ muss exakt passen.
                  activeOptions={{ exact: tool.to === "/" }}
                  className={cn(
                    ITEM_CLASS,
                    "hover:bg-muted/60 hover:text-foreground",
                    "data-[status=active]:bg-muted data-[status=active]:text-foreground",
                    "data-[status=active]:before:absolute data-[status=active]:before:top-2 data-[status=active]:before:bottom-2 data-[status=active]:before:-left-2 data-[status=active]:before:w-0.5 data-[status=active]:before:rounded-full data-[status=active]:before:bg-primary",
                    // Mobil liegt die Leiste oben, der Aktiv-Strich wandert an die Unterkante.
                    "max-md:data-[status=active]:before:top-auto max-md:data-[status=active]:before:right-2 max-md:data-[status=active]:before:-bottom-2 max-md:data-[status=active]:before:left-2 max-md:data-[status=active]:before:h-0.5 max-md:data-[status=active]:before:w-auto"
                  )}
                />
              }
            >
              <Icon className="size-5" />
            </TooltipTrigger>
            <TooltipContent side="right">{tool.label}</TooltipContent>
          </Tooltip>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1 max-md:mt-0 max-md:ml-auto max-md:flex-row">
        <AccountDialog userKey={userKey} name={userName} />
        <InfoDialog />
      </div>
    </nav>
  );
}
