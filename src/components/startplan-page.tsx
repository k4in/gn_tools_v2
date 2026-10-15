// React
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Packages
import { useQuery } from "convex/react";

// Convex
import { api } from "@convex/_generated/api.ts";

// Lib/Utils
import {
  isPlanSlotId,
  PLAN_SLOT_IDS,
  planSlotLabel,
  planTemplates,
  type PlanEntry,
  type PlanSlotId,
  type RoidMulti,
} from "@/lib/gn-data/plan.ts";
import {
  ASTEROID_COST,
  attackRoidStartTick,
  clampAttackDuration,
  byName,
  calculateFastestWayToGoal,
  clampAttackRoidDuration,
  clockLabel,
  computeCurrentTick,
  extractorBatchCost,
  getAddableTechs,
  getDefenses,
  getEarliestAsteroidStartTick,
  getEarliestBuildStartTick,
  getEarliestExtractorStartTick,
  getEarliestTechStartTick,
  getExtractorSlotShortage,
  getMaxBuildCountAtTick,
  getMaxExtractorsAtTick,
  getReconItems,
  getResourcesAtTick,
  getShips,
  hasTechInPlan,
  missingRequiredTechs,
  newPlanEntryId,
  reconByName,
  removePlanEntryCascade,
  unitByName,
  type StartConfig,
} from "@/lib/calculate-fastest-way-to-goal.ts";
import {
  configFromPlan,
  localDateKey,
  parseImportedPlan,
  planExportJson,
  toStoredEntries,
  type PlanSettings,
  type StoredPlan,
} from "@/lib/utils/plan-data.ts";

// Hooks
import { useNow } from "@/hooks/useNow.tsx";
import { useUpdatePlan } from "@/hooks/useUpdatePlan.tsx";
import { useUserKey } from "@/hooks/useUserKey.tsx";
import { useUserSlots } from "@/hooks/useUserSlots.tsx";

// Shadcn components
import { TooltipProvider } from "@/components/shadcn/tooltip.tsx";

// Components
import { Header } from "@/components/header.tsx";
import { Overview } from "@/components/overview/overview.tsx";
import { PageLoading } from "@/components/page-loading.tsx";
import { PlanEntryDialog, type PlanEntryDialogTarget } from "@/components/plan-entry-dialog.tsx";
import { PlanSwitcher } from "@/components/plan-switcher.tsx";
import { Sidebar } from "@/components/sidebar/sidebar.tsx";

/** Plan ohne einen Eintrag, z. B. um beim Bearbeiten das freie Budget zu bestimmen. */
function withoutPlanEntry(cfg: StartConfig, entryId: string): StartConfig {
  return { ...cfg, plan: cfg.plan.filter((e) => e.id !== entryId) };
}

function defaultAddTick(inspectTick: number | null, currentTick: number, earliest = 0): number {
  const preferred = inspectTick != null ? inspectTick : currentTick;
  return Math.max(0, preferred, earliest);
}

function logMutationError(error: unknown) {
  console.error("Konnte Plan nicht speichern", error);
}

/** Lädt die Plan-Slots des eingeloggten Nutzers aus Convex. */
export function StartplanPage() {
  const { userKey } = useUserKey();
  const plans = useQuery(api.plans.list, userKey ? { key: userKey } : "skip");
  const me = useQuery(api.users.me, userKey ? { key: userKey } : "skip");

  if (!userKey || !plans || !me) return <PageLoading />;
  return <Planner userKey={userKey} plans={plans} viewId={me.activeSlot} liveSlot={me.liveSlot} />;
}

type PlannerProps = {
  userKey: string;
  plans: StoredPlan[];
  /** Angesehener Slot. */
  viewId: PlanSlotId;
  /** Gespielter Slot, mit dem die anderen Tools rechnen. */
  liveSlot: PlanSlotId | null;
};

function Planner({ userKey, plans, viewId, liveSlot }: PlannerProps) {
  const updatePlan = useUpdatePlan();
  const { setActiveSlot, setLiveSlot } = useUserSlots();
  const activeSlot = viewId;
  const current = plans.find((item) => item.slot === viewId) ?? plans[0];

  const now = useNow();
  const today = localDateKey(now);
  const startCfg = useMemo(() => configFromPlan(current, today), [current, today]);

  function savePlan(patch: { entries?: PlanEntry[]; taxes?: StoredPlan["taxes"]; ignoreNonTechDeps?: boolean; settings?: PlanSettings }) {
    const { entries, ...rest } = patch;
    void updatePlan({
      key: userKey,
      slot: viewId,
      ...rest,
      ...(entries ? { entries: toStoredEntries(entries) } : {}),
    }).catch(logMutationError);
  }

  function updateCurrentPlan(updater: (plan: PlanEntry[]) => PlanEntry[]) {
    savePlan({ entries: updater(startCfg.plan) });
  }

  const currentTick = computeCurrentTick(startCfg, now);

  const plan = useMemo(() => {
    try {
      return calculateFastestWayToGoal(startCfg, currentTick);
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [startCfg, currentTick]);

  const addableTechs = useMemo(() => getAddableTechs(startCfg.plan), [startCfg.plan]);
  const neededTechs = useMemo(() => missingRequiredTechs(startCfg.plan), [startCfg.plan]);
  const plannedTechs = useMemo(() => new Set(startCfg.plan.filter((e) => e.kind === "tech").map((e) => e.name)), [startCfg.plan]);
  const allShips = useMemo(() => getShips(), []);
  const allDefenses = useMemo(() => getDefenses(), []);
  const allRecon = useMemo(() => getReconItems(), []);

  const hasObservatorium = hasTechInPlan(startCfg.plan, "Observatorium");
  const hasExtraktorTech = hasTechInPlan(startCfg.plan, "Extraktor");
  const hasInterstellarerHandel = hasTechInPlan(startCfg.plan, "Interstellarer Handel");

  const attackBlocked = !hasTechInPlan(startCfg.plan, "Marineakademie");

  // Timeline bis zum letzten simulierten Tick (Planende inkl. Angriffsflüge bzw. aktueller Tick, plus Vorschau).
  const maxTick = Math.max(
    plan?.ticks.at(-1)?.tick ?? 1,
    plan?.finishTick ?? 1,
    ...(plan?.steps ?? []).filter((s) => s.type === "attack").map((s) => s.endTick),
    1
  );
  const actionTicks = useMemo(() => (plan ? plan.ticks.filter((t) => t.started.length > 0) : []), [plan]);

  const nextAction = useMemo(() => {
    const ticks = actionTicks.filter((t) =>
      t.started.some((job) => job.type !== "custom" && job.type !== "trade" && job.type !== "snapshot")
    );
    return ticks.find((t) => t.tick >= currentTick) ?? null;
  }, [actionTicks, currentTick]);

  const [inspectTick, setInspectTick] = useState<number | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [dialogTarget, setDialogTarget] = useState<PlanEntryDialogTarget | null>(null);
  const [editingEntry, setEditingEntry] = useState<PlanEntry | null>(null);

  // Beim Bearbeiten ohne den Eintrag selbst simulieren, sonst fehlen dessen Kosten im Budget
  // (bzw. zählen doppelt, wenn er später startet). Memoisiert, damit der Simulations-Cache greift.
  const unitBudgetCfg = useMemo(
    () => (dialogMode === "edit" && editingEntry ? withoutPlanEntry(startCfg, editingEntry.id) : startCfg),
    [dialogMode, editingEntry, startCfg]
  );

  // Stabile Callbacks: der Dialog rechnet nur neu, wenn sich Plan, Ziel oder Tick ändern,
  // nicht bei jedem sekündlichen Re-Render durch die Uhr.
  const resolveMaxCount = useCallback(
    (tick: number) => {
      if (!dialogTarget) return 1;
      if (dialogTarget.kind === "unit" || dialogTarget.kind === "recon") {
        return getMaxBuildCountAtTick(unitBudgetCfg, dialogTarget.kind, dialogTarget.name, tick);
      }
      return 999;
    },
    [dialogTarget, unitBudgetCfg]
  );

  const resolveEconomyAtTick = useCallback(
    (tick: number) => {
      const info = getMaxExtractorsAtTick(startCfg, tick);
      const snap = getResourcesAtTick(startCfg, tick);
      let bonusAst = 0;
      let bonusExt = 0;
      if (dialogMode === "edit" && editingEntry) {
        if (editingEntry.kind === "economy") {
          bonusAst = editingEntry.asteroids;
          bonusExt = editingEntry.extractorsMet + editingEntry.extractorsKris;
        } else if (editingEntry.kind === "asteroids") {
          bonusAst = editingEntry.count;
        } else if (editingEntry.kind === "extractors") {
          bonusExt = editingEntry.count;
        }
      }
      const asteroids = Math.max(0, info.asteroids - bonusAst);
      const alreadyBuilt = Math.max(0, info.alreadyBuilt - bonusExt);
      const freeSlots = Math.max(0, asteroids * 20 - alreadyBuilt);
      // Refund costs of the entry being edited so max reflects free budget.
      const refundKris = bonusAst * ASTEROID_COST.kris;
      const refundMet = bonusExt > 0 ? extractorBatchCost(alreadyBuilt, bonusExt) : 0;
      let met = snap.met + refundMet;
      let kris = snap.kris + refundKris;
      if (dialogMode === "edit" && editingEntry?.kind === "trade") {
        if (editingEntry.give === "met") met += editingEntry.giveAmount;
        else kris += editingEntry.giveAmount;
      }
      return {
        freeSlots,
        asteroids,
        alreadyBuilt,
        met,
        kris,
      };
    },
    [dialogMode, editingEntry, startCfg]
  );

  // Stabile Props für die memoisierte Timeline.
  const tickClock = useCallback((tick: number) => clockLabel(startCfg, tick), [startCfg]);
  const exportJson = useMemo(() => planExportJson(current), [current]);
  const openEditEntryRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    openEditEntryRef.current = openEditEntry;
  });
  const onEditJob = useCallback((planEntryId: string | undefined) => {
    if (planEntryId) openEditEntryRef.current(planEntryId);
  }, []);

  function openAddTech(name: string) {
    const tech = byName().get(name);
    if (!tech) return;
    const defaultTick = defaultAddTick(inspectTick, currentTick, getEarliestTechStartTick(startCfg, name));
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({ kind: "tech", tech, defaultTick });
    setDialogOpen(true);
  }

  function openAddUnit(name: string) {
    const unit = unitByName(name);
    if (!unit) return;
    const defaultTick = defaultAddTick(inspectTick, currentTick, getEarliestBuildStartTick(startCfg, "unit", name));
    const maxCount = Math.max(1, getMaxBuildCountAtTick(startCfg, "unit", name, defaultTick));
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "unit",
      name: unit.name,
      ticks: unit.ticks,
      cost: unit.cost,
      dependencies: unit.dependencies,
      defaultTick,
      defaultCount: maxCount,
      maxCount,
    });
    setDialogOpen(true);
  }

  function openAddRecon(name: string) {
    const item = reconByName(name);
    if (!item) return;
    const defaultTick = defaultAddTick(inspectTick, currentTick, getEarliestBuildStartTick(startCfg, "recon", name));
    const maxCount = Math.max(1, getMaxBuildCountAtTick(startCfg, "recon", name, defaultTick));
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "recon",
      name: item.name,
      ticks: item.ticks,
      cost: item.cost,
      dependencies: item.dependencies,
      defaultTick,
      defaultCount: maxCount,
      maxCount,
    });
    setDialogOpen(true);
  }

  function openAddEconomy(
    preset: {
      asteroids?: number;
      extractorsMet?: number;
      extractorsKris?: number;
    } = {}
  ) {
    const earliest = hasExtraktorTech
      ? getEarliestExtractorStartTick(startCfg)
      : hasObservatorium
        ? getEarliestAsteroidStartTick(startCfg)
        : 0;
    const defaultTick = defaultAddTick(inspectTick, currentTick, earliest);
    const info = getMaxExtractorsAtTick(startCfg, defaultTick);
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "economy",
      defaultTick,
      defaultAsteroids: preset.asteroids ?? 0,
      defaultExtractorsMet: preset.extractorsMet ?? 0,
      defaultExtractorsKris: preset.extractorsKris ?? 0,
      freeSlots: info.freeSlots,
      asteroidsOwned: info.asteroids,
      alreadyBuilt: info.alreadyBuilt,
      canAsteroids: true,
      canExtractors: true,
      costKrisPerAsteroid: ASTEROID_COST.kris,
    });
    setDialogOpen(true);
  }

  function openAddCustom() {
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "custom",
      defaultTick: defaultAddTick(inspectTick, currentTick),
      defaultLabel: "",
      defaultMet: 0,
      defaultKris: 0,
    });
    setDialogOpen(true);
  }

  function openAddTrade() {
    const doneTick = plan?.steps.find((s) => s.name === "Interstellarer Handel")?.endTick ?? 0;
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "trade",
      defaultTick: defaultAddTick(inspectTick, currentTick, doneTick),
      defaultGive: "met",
      defaultGiveAmount: 0,
      defaultReceiveAmount: 0,
    });
    setDialogOpen(true);
  }

  // Kampffenster aller Roids (alte Roid-Einträge + Angriffsflüge mit Ziel-Exen).
  function occupiedRoids(exceptId?: string) {
    return startCfg.plan.flatMap((e) => {
      if (e.id === exceptId) return [];
      if (e.kind === "roid") {
        return [
          {
            startTick: e.startTick,
            duration: e.duration,
            targetMet: e.targetMet,
            targetKris: e.targetKris,
          },
        ];
      }
      if (e.kind === "attack" && (e.targetMet > 0 || e.targetKris > 0)) {
        return [
          {
            startTick: attackRoidStartTick(e.startTick, e.duration, e.roidDuration),
            duration: clampAttackRoidDuration(e.roidDuration, e.duration),
            targetMet: e.targetMet,
            targetKris: e.targetKris,
          },
        ];
      }
      return [];
    });
  }

  function openAddCatastrophe() {
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "catastrophe",
      defaultTick: defaultAddTick(inspectTick, currentTick),
      defaultDuration: 1,
    });
    setDialogOpen(true);
  }

  function openAddAttack() {
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "attack",
      defaultTick: defaultAddTick(inspectTick, currentTick),
      defaultDuration: 5,
      defaultRoidDuration: 5,
      defaultTargetMet: 0,
      defaultTargetKris: 0,
      defaultNoReturn: false,
      occupiedRoids: occupiedRoids(),
    });
    setDialogOpen(true);
  }

  function openAddSnapshot() {
    const defaultTick = currentTick > 0 ? currentTick : 1;
    const snap = getResourcesAtTick(startCfg, defaultTick);
    setDialogMode("add");
    setEditingEntry(null);
    setDialogTarget({
      kind: "snapshot",
      defaultTick,
      defaultMet: snap.met,
      defaultKris: snap.kris,
      defaultExtractorsMet: snap.extractorsMet,
      defaultExtractorsKris: snap.extractorsKris,
      defaultAsteroids: snap.asteroids,
    });
    setDialogOpen(true);
  }

  function openEditEntry(id: string) {
    const entry = startCfg.plan.find((e) => e.id === id);
    if (!entry) return;
    setDialogMode("edit");
    setEditingEntry(entry);

    if (entry.kind === "tech") {
      const tech = byName().get(entry.name);
      if (!tech) return;
      setDialogTarget({
        kind: "tech",
        tech,
        defaultTick: entry.startTick,
      });
    } else if (entry.kind === "unit") {
      const unit = unitByName(entry.name) ?? {
        name: entry.name,
        ticks: 0,
        time: 0,
        cost: { met: 0, kris: 0 },
        dependencies: [],
      };
      const maxCount = getMaxBuildCountAtTick(withoutPlanEntry(startCfg, entry.id), "unit", entry.name, entry.startTick);
      setDialogTarget({
        kind: "unit",
        name: entry.name,
        ticks: unit.ticks,
        cost: unit.cost,
        dependencies: unit.dependencies,
        defaultTick: entry.startTick,
        defaultCount: entry.count,
        maxCount,
      });
    } else if (entry.kind === "recon") {
      const item = reconByName(entry.name);
      const maxCount = getMaxBuildCountAtTick(withoutPlanEntry(startCfg, entry.id), "recon", entry.name, entry.startTick);
      setDialogTarget({
        kind: "recon",
        name: entry.name,
        ticks: item?.ticks ?? 0,
        cost: item?.cost ?? { met: 0, kris: 0 },
        dependencies: item?.dependencies ?? [],
        defaultTick: entry.startTick,
        defaultCount: entry.count,
        maxCount,
      });
    } else if (entry.kind === "economy" || entry.kind === "asteroids" || entry.kind === "extractors") {
      const eco =
        entry.kind === "economy"
          ? {
              asteroids: entry.asteroids,
              extractorsMet: entry.extractorsMet,
              extractorsKris: entry.extractorsKris,
              startTick: entry.startTick,
            }
          : entry.kind === "asteroids"
            ? {
                asteroids: entry.count,
                extractorsMet: 0,
                extractorsKris: 0,
                startTick: entry.startTick,
              }
            : {
                asteroids: 0,
                extractorsMet: entry.resource === "met" ? entry.count : 0,
                extractorsKris: entry.resource === "kris" ? entry.count : 0,
                startTick: entry.startTick,
              };
      const info = getMaxExtractorsAtTick(startCfg, eco.startTick);
      const asteroidsOwned = Math.max(0, info.asteroids - eco.asteroids);
      const alreadyBuilt = Math.max(0, info.alreadyBuilt - eco.extractorsMet - eco.extractorsKris);
      const freeSlots = Math.max(0, asteroidsOwned * 20 - alreadyBuilt);
      setDialogTarget({
        kind: "economy",
        defaultTick: eco.startTick,
        defaultAsteroids: eco.asteroids,
        defaultExtractorsMet: eco.extractorsMet,
        defaultExtractorsKris: eco.extractorsKris,
        freeSlots,
        asteroidsOwned,
        alreadyBuilt,
        canAsteroids: true,
        canExtractors: true,
        costKrisPerAsteroid: ASTEROID_COST.kris,
      });
    } else if (entry.kind === "custom") {
      setDialogTarget({
        kind: "custom",
        defaultTick: entry.startTick,
        defaultLabel: entry.label,
        defaultMet: entry.cost.met,
        defaultKris: entry.cost.kris,
      });
    } else if (entry.kind === "trade") {
      setDialogTarget({
        kind: "trade",
        defaultTick: entry.startTick,
        defaultGive: entry.give,
        defaultGiveAmount: entry.giveAmount,
        defaultReceiveAmount: entry.receiveAmount,
      });
    } else if (entry.kind === "roid") {
      setDialogTarget({
        kind: "roid",
        defaultTick: entry.startTick,
        defaultTargetMet: entry.targetMet,
        defaultTargetKris: entry.targetKris,
        defaultDuration: entry.duration,
        defaultMulti: entry.multi,
        occupiedRoids: occupiedRoids(entry.id),
      });
    } else if (entry.kind === "catastrophe") {
      setDialogTarget({
        kind: "catastrophe",
        defaultTick: entry.startTick,
        defaultDuration: entry.duration,
      });
    } else if (entry.kind === "attack") {
      setDialogTarget({
        kind: "attack",
        defaultTick: entry.startTick,
        defaultDuration: entry.duration,
        defaultRoidDuration: clampAttackRoidDuration(entry.roidDuration, entry.duration),
        defaultTargetMet: entry.targetMet,
        defaultTargetKris: entry.targetKris,
        defaultMulti: entry.multi,
        defaultNoReturn: !!entry.noReturn,
        occupiedRoids: occupiedRoids(entry.id),
      });
    } else if (entry.kind === "snapshot") {
      setDialogTarget({
        kind: "snapshot",
        defaultTick: entry.startTick,
        defaultMet: entry.met,
        defaultKris: entry.kris,
        defaultExtractorsMet: entry.extractorsMet,
        defaultExtractorsKris: entry.extractorsKris,
        defaultAsteroids: entry.asteroids,
      });
    }
    setDialogOpen(true);
  }

  function handleDialogSubmit(values: {
    startTick: number;
    count?: number;
    asteroids?: number;
    extractorsMet?: number;
    extractorsKris?: number;
    label?: string;
    cost?: { met: number; kris: number };
    give?: "met" | "kris";
    giveAmount?: number;
    receiveAmount?: number;
    targetMet?: number;
    targetKris?: number;
    duration?: number;
    multi?: RoidMulti;
    noReturn?: boolean;
    roidDuration?: number;
  }) {
    if (!dialogTarget) return;

    if (dialogMode === "edit" && editingEntry) {
      updateCurrentPlan((plan) =>
        plan.map((e) => {
          if (e.id !== editingEntry.id) return e;
          if (e.kind === "tech") {
            return { ...e, startTick: values.startTick };
          }
          if (e.kind === "economy" || e.kind === "asteroids" || e.kind === "extractors") {
            const asteroids = Math.max(0, values.asteroids ?? 0);
            const extractorsMet = Math.max(0, values.extractorsMet ?? 0);
            const extractorsKris = Math.max(0, values.extractorsKris ?? 0);
            return {
              id: e.id,
              kind: "economy" as const,
              startTick: values.startTick,
              asteroids,
              extractorsMet,
              extractorsKris,
            };
          }
          if (e.kind === "custom") {
            return {
              ...e,
              startTick: values.startTick,
              label: (values.label ?? e.label).trim() || e.label,
              cost: {
                met: Math.max(0, values.cost?.met ?? e.cost.met),
                kris: Math.max(0, values.cost?.kris ?? e.cost.kris),
              },
            };
          }
          if (e.kind === "trade") {
            const give = values.give === "kris" ? "kris" : "met";
            return {
              ...e,
              startTick: values.startTick,
              give,
              giveAmount: Math.max(0, values.giveAmount ?? e.giveAmount),
              receiveAmount: Math.max(0, values.receiveAmount ?? e.receiveAmount),
            };
          }
          if (e.kind === "roid") {
            return {
              ...e,
              startTick: values.startTick,
              targetMet: Math.max(0, values.targetMet ?? e.targetMet),
              targetKris: Math.max(0, values.targetKris ?? e.targetKris),
              duration: Math.min(10, Math.max(1, values.duration ?? e.duration)),
              multi: values.multi ?? undefined,
            };
          }
          if (e.kind === "catastrophe") {
            return {
              ...e,
              startTick: values.startTick,
              duration: Math.min(25, Math.max(1, values.duration ?? e.duration)),
            };
          }
          if (e.kind === "attack") {
            return {
              id: e.id,
              kind: "attack",
              startTick: values.startTick,
              duration: clampAttackDuration(values.duration ?? e.duration),
              roidDuration: clampAttackRoidDuration(values.roidDuration ?? e.roidDuration, values.duration ?? e.duration),
              targetMet: Math.max(0, values.targetMet ?? e.targetMet),
              targetKris: Math.max(0, values.targetKris ?? e.targetKris),
              ...(values.multi ? { multi: values.multi } : {}),
              ...(values.noReturn ? { noReturn: true } : {}),
            };
          }
          if (e.kind === "snapshot") {
            return {
              ...e,
              startTick: values.startTick,
              met: Math.max(0, values.cost?.met ?? e.met),
              kris: Math.max(0, values.cost?.kris ?? e.kris),
              extractorsMet: Math.max(0, values.extractorsMet ?? e.extractorsMet),
              extractorsKris: Math.max(0, values.extractorsKris ?? e.extractorsKris),
              asteroids: Math.max(0, values.asteroids ?? e.asteroids),
            };
          }
          return {
            ...e,
            startTick: values.startTick,
            count: values.count ?? ("count" in e ? e.count : 1),
          } as PlanEntry;
        })
      );
      return;
    }

    // add
    if (dialogTarget.kind === "tech") {
      const name = dialogTarget.tech.name;
      updateCurrentPlan((plan) => {
        if (plan.some((e) => e.kind === "tech" && e.name === name)) return plan;
        const entry: PlanEntry = {
          id: newPlanEntryId("tech"),
          kind: "tech",
          name,
          startTick: values.startTick,
        };
        return [...plan, entry];
      });
      return;
    }

    if (dialogTarget.kind === "unit") {
      const entry: PlanEntry = {
        id: newPlanEntryId("unit"),
        kind: "unit",
        name: dialogTarget.name,
        startTick: values.startTick,
        count: Math.max(1, values.count ?? 1),
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "recon") {
      const entry: PlanEntry = {
        id: newPlanEntryId("recon"),
        kind: "recon",
        name: dialogTarget.name,
        startTick: values.startTick,
        count: Math.max(1, values.count ?? 1),
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "economy") {
      const asteroids = Math.max(0, values.asteroids ?? 0);
      const extractorsMet = Math.max(0, values.extractorsMet ?? 0);
      const extractorsKris = Math.max(0, values.extractorsKris ?? 0);
      if (asteroids <= 0 && extractorsMet <= 0 && extractorsKris <= 0) return;
      const entry: PlanEntry = {
        id: newPlanEntryId("eco"),
        kind: "economy",
        startTick: values.startTick,
        asteroids,
        extractorsMet,
        extractorsKris,
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "custom") {
      const label = (values.label ?? "").trim();
      if (!label) return;
      const entry: PlanEntry = {
        id: newPlanEntryId("custom"),
        kind: "custom",
        startTick: values.startTick,
        label,
        cost: {
          met: Math.max(0, values.cost?.met ?? 0),
          kris: Math.max(0, values.cost?.kris ?? 0),
        },
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "trade") {
      const give = values.give === "kris" ? "kris" : "met";
      const giveAmount = Math.max(0, values.giveAmount ?? 0);
      const receiveAmount = Math.max(0, values.receiveAmount ?? 0);
      if (giveAmount <= 0 && receiveAmount <= 0) return;
      const entry: PlanEntry = {
        id: newPlanEntryId("trade"),
        kind: "trade",
        startTick: values.startTick,
        give,
        giveAmount,
        receiveAmount,
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "roid") {
      const targetMet = Math.max(0, values.targetMet ?? 0);
      const targetKris = Math.max(0, values.targetKris ?? 0);
      const duration = Math.min(10, Math.max(1, values.duration ?? 1));
      if (targetMet <= 0 && targetKris <= 0) return;
      const entry: PlanEntry = {
        id: newPlanEntryId("roid"),
        kind: "roid",
        startTick: values.startTick,
        targetMet,
        targetKris,
        duration,
        ...(values.multi ? { multi: values.multi } : {}),
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "catastrophe") {
      const duration = Math.min(25, Math.max(1, values.duration ?? 1));
      const entry: PlanEntry = {
        id: newPlanEntryId("cat"),
        kind: "catastrophe",
        startTick: values.startTick,
        duration,
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "attack") {
      const entry: PlanEntry = {
        id: newPlanEntryId("atk"),
        kind: "attack",
        startTick: values.startTick,
        duration: clampAttackDuration(values.duration ?? 5),
        roidDuration: clampAttackRoidDuration(values.roidDuration, values.duration ?? 5),
        targetMet: Math.max(0, values.targetMet ?? 0),
        targetKris: Math.max(0, values.targetKris ?? 0),
        ...(values.multi ? { multi: values.multi } : {}),
        ...(values.noReturn ? { noReturn: true } : {}),
      };
      updateCurrentPlan((plan) => [...plan, entry]);
      return;
    }

    if (dialogTarget.kind === "snapshot") {
      const entry: PlanEntry = {
        id: newPlanEntryId("snap"),
        kind: "snapshot",
        startTick: values.startTick,
        met: Math.max(0, values.cost?.met ?? 0),
        kris: Math.max(0, values.cost?.kris ?? 0),
        extractorsMet: Math.max(0, values.extractorsMet ?? 0),
        extractorsKris: Math.max(0, values.extractorsKris ?? 0),
        asteroids: Math.max(0, values.asteroids ?? 0),
      };
      updateCurrentPlan((plan) => [...plan, entry]);
    }
  }

  function handleDialogRemove() {
    if (!editingEntry) return;
    updateCurrentPlan((plan) => removePlanEntryCascade(plan, editingEntry.id));
    setDialogOpen(false);
    setEditingEntry(null);
  }

  function resetPlan(sourceId: string) {
    if (sourceId.startsWith("template:")) {
      const templateId = sourceId.slice("template:".length);
      const template = planTemplates.find((item) => item.id === templateId);
      if (!template) return;
      savePlan({ entries: template.plan, taxes: [], ignoreNonTechDeps: false });
    } else if (sourceId.startsWith("plan:")) {
      const id = Number(sourceId.slice("plan:".length));
      const source = plans.find((item) => item.slot === id);
      if (!isPlanSlotId(id) || id === viewId || !source) return;
      // Die Einstellungen (Startzeit usw.) gehören zum Slot und bleiben.
      savePlan({ entries: source.entries, taxes: source.taxes, ignoreNonTechDeps: source.ignoreNonTechDeps });
    }
  }

  /** Ersetzt den Plan durch ein importiertes JSON. Gibt eine Fehlermeldung zurück, wenn es ungültig ist. */
  function importPlan(json: string): string | null {
    const result = parseImportedPlan(json, current.settings);
    if (!result.ok) return result.error;
    savePlan({
      entries: result.entries,
      taxes: result.taxes,
      ...(result.ignoreNonTechDeps !== undefined ? { ignoreNonTechDeps: result.ignoreNonTechDeps } : {}),
      ...(result.settings ? { settings: result.settings } : {}),
    });
    return null;
  }

  return (
    <TooltipProvider>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
        <Header
          now={now}
          currentTick={currentTick}
          startCfg={startCfg}
          plan={plan}
          nextAction={nextAction}
          settings={current.settings}
          onApplySettings={(settings) => savePlan({ settings })}
          planSwitcher={
            <PlanSwitcher
              viewId={viewId}
              livePlanId={liveSlot}
              onViewChange={(id) => {
                void setActiveSlot({ key: userKey, slot: id }).catch(logMutationError);
              }}
            />
          }
        />
        <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)]">
          <Sidebar
            techs={addableTechs}
            neededTechs={neededTechs}
            plannedTechs={plannedTechs}
            ships={allShips}
            defenses={allDefenses}
            recon={allRecon}
            hasObservatorium={hasObservatorium}
            hasExtraktorTech={hasExtraktorTech}
            attackBlocked={attackBlocked}
            onAddTech={openAddTech}
            onAddUnit={openAddUnit}
            onAddRecon={openAddRecon}
            onAddEconomy={openAddEconomy}
            onAddCatastrophe={openAddCatastrophe}
            onAddAttack={openAddAttack}
            onAddCustom={openAddCustom}
            onAddTrade={openAddTrade}
            hasInterstellarerHandel={hasInterstellarerHandel}
            ignoreMissingDeps={startCfg.ignore_non_tech_deps}
          />
          <Overview
            actionTicks={actionTicks}
            logTicks={plan?.ticks ?? []}
            steps={plan?.steps ?? []}
            maxTick={maxTick}
            currentTick={currentTick}
            historyWindow={current.settings.historyWindow}
            inspectTick={inspectTick}
            onInspectTick={setInspectTick}
            tickClock={tickClock}
            hasPlan={!!plan}
            slotShortage={plan ? getExtractorSlotShortage(plan) : null}
            exportJson={exportJson}
            exportPlanSlot={activeSlot}
            onImportPlan={importPlan}
            resetSources={[
              ...planTemplates.map((template) => ({
                id: `template:${template.id}`,
                label: template.label,
              })),
              ...PLAN_SLOT_IDS.filter((id) => id !== activeSlot).map((id) => ({
                id: `plan:${id}`,
                label: planSlotLabel(id),
              })),
            ]}
            onResetPlan={resetPlan}
            taxes={startCfg.taxes}
            onAddSnapshot={openAddSnapshot}
            ignoreNonTechDeps={startCfg.ignore_non_tech_deps}
            onIgnoreNonTechDepsChange={(ignoreNonTechDeps) => savePlan({ ignoreNonTechDeps })}
            onApplyTaxes={(taxes) => savePlan({ taxes })}
            isLivePlan={liveSlot === activeSlot}
            onSetLivePlan={() => {
              void setLiveSlot({ key: userKey, slot: activeSlot }).catch(logMutationError);
            }}
            onEditJob={onEditJob}
          />
        </div>

        <PlanEntryDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode={dialogMode}
          target={dialogTarget}
          startCfg={startCfg}
          entry={editingEntry}
          onSubmit={handleDialogSubmit}
          onRemove={dialogMode === "edit" ? handleDialogRemove : undefined}
          resolveMaxCount={resolveMaxCount}
          resolveEconomyAtTick={resolveEconomyAtTick}
        />
      </main>
    </TooltipProvider>
  );
}
