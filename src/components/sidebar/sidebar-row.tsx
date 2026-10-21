import { type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/react";
import { GripVertical, Plus } from "lucide-react";
import { type NewPlanItem, type PlanDragData } from "@/types/plan-drag.ts";
import { cn } from "@/lib/utils/cn.ts";

export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pt-3 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{children}</div>;
}

export type SidebarRowProps = {
  title: ReactNode;
  meta?: ReactNode;
  titleClassName?: string;
  tone?: "default" | "destructive";
  /** Eintrag, der beim Ziehen in die Timeline angelegt wird; `label` erscheint am Mauszeiger. */
  drag: { item: NewPlanItem; label: string };
  onClick: () => void;
};

function dragId(item: NewPlanItem) {
  return "name" in item ? `sidebar:${item.kind}:${item.name}` : `sidebar:${item.kind}`;
}

/** Eine Zeile, die per Klick (Dialog) oder per Ziehen in die Timeline einen Eintrag zum Plan hinzufügt. */
export function SidebarRow({ title, meta, titleClassName, tone = "default", drag, onClick }: SidebarRowProps) {
  const { ref } = useDraggable<PlanDragData>({
    id: dragId(drag.item),
    data: { source: "sidebar", item: drag.item, label: drag.label },
  });

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={cn(
          "group/row flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40",
          tone === "destructive" && "hover:bg-destructive/15"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-xs leading-5", titleClassName)}>{title}</span>
          {meta ? <span className="block truncate text-[11px] leading-4 text-muted-foreground tabular-nums">{meta}</span> : null}
        </span>
        <GripVertical
          aria-hidden
          className="size-3.5 shrink-0 text-transparent transition-colors group-hover/row:text-muted-foreground/60"
        />
        <Plus
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover/row:text-foreground group-focus-visible/row:text-foreground"
        />
      </button>
    </li>
  );
}
