import { useMemo } from "react";
import { CircleCheck, CircleDashed, Clock, ScrollText } from "lucide-react";
import { Button } from "@/components/shadcn/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/shadcn/dialog.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shadcn/table.tsx";
import { type TickSnapshot } from "@/lib/calculate-fastest-way-to-goal.ts";
import { formatQuestReward, QUESTS } from "@/lib/gn-data/quests.ts";
import { cn } from "@/lib/utils/cn.ts";

export type QuestsDialogProps = {
  ticks: TickSnapshot[];
  currentTick: number;
};

type QuestStatus = { kind: "done"; tick: TickSnapshot } | { kind: "planned"; tick: TickSnapshot } | { kind: "open" };

function questStatus(claimedAt: TickSnapshot | undefined, currentTick: number): QuestStatus {
  if (!claimedAt) return { kind: "open" };
  return claimedAt.tick <= currentTick ? { kind: "done", tick: claimedAt } : { kind: "planned", tick: claimedAt };
}

function StatusCell({ status }: { status: QuestStatus }) {
  if (status.kind === "open") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleDashed className="size-3.5" />
        Offen
      </span>
    );
  }
  const done = status.kind === "done";
  return (
    <span className={cn("inline-flex items-center gap-1.5", done ? "text-green-500" : "text-sky-500")}>
      {done ? <CircleCheck className="size-3.5" /> : <Clock className="size-3.5" />}
      {done ? "Erledigt" : "Geplant"}
      <span className="text-muted-foreground tabular-nums">
        T{status.tick.tick} · {status.tick.clockLabel}
      </span>
    </span>
  );
}

export function QuestsDialog({ ticks, currentTick }: QuestsDialogProps) {
  // Tick, in dem die Quest laut Plan ausgeschüttet wird.
  const claimedAt = useMemo(() => {
    const map = new Map<string, TickSnapshot>();
    for (const tick of ticks) {
      for (const quest of tick.quests) {
        if (!map.has(quest.id)) map.set(quest.id, tick);
      }
    }
    return map;
  }, [ticks]);

  const rows = QUESTS.map((quest) => ({ quest, status: questStatus(claimedAt.get(quest.id), currentTick) }));
  const doneCount = rows.filter((row) => row.status.kind === "done").length;

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <ScrollText data-icon="inline-start" />
        Quests
        <span className="font-normal text-muted-foreground tabular-nums">
          {doneCount}/{QUESTS.length}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Quests</DialogTitle>
          <DialogDescription>
            Erledigt sind Quests, die laut Plan bis zum aktuellen Tick ausgeschüttet wurden. Geplante Quests werden später im Plan erfüllt,
            offene gar nicht.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quest</TableHead>
                <TableHead>Belohnung</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ quest, status }) => (
                <TableRow key={quest.id} className={cn(status.kind === "done" && "opacity-70")}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{quest.title}</div>
                    <div className="text-xs text-muted-foreground">{quest.description}</div>
                  </TableCell>
                  <TableCell className="text-green-500 tabular-nums">{formatQuestReward(quest.reward)}</TableCell>
                  <TableCell>
                    <StatusCell status={status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
