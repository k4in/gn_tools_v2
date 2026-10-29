// React
import { useEffect, useMemo, useRef, useState } from "react";

// Packages
import { ArrowLeftRight, Plus, X } from "lucide-react";

// Types
import { type PlanEntry, type RoidCoAttacker, type RoidMulti } from "@/lib/gn-data/plan.ts";
import { type TechTreeEntry } from "@/lib/gn-data/techtree.ts";
import { type Defense } from "@/lib/gn-data/defense.ts";
import { type Ship } from "@/lib/gn-data/ships.ts";
import { type Utility } from "@/lib/gn-data/utility.ts";

// Lib/Utils
import {
  ASTEROID_COST,
  ASTEROID_SLOT_CAPACITY,
  ATTACK_DURATION_MAX,
  ATTACK_DURATION_MIN,
  ATTACK_FLIGHT_TICKS,
  attackFirstCombatTick,
  attackRoidStartTick,
  attackTotalTicks,
  clampAttackRoidDuration,
  computeRoidLoot,
  extractorBatchCost,
  extractorUnitCost,
  CATASTROPHE_DURATION_MAX,
  CATASTROPHE_DURATION_MIN,
  clockLabel,
  formatAttackPlanLabel,
  formatCatastrophePlanLabel,
  formatRes,
  formatRoidPlanLabel,
  formatSnapshotPlanLabel,
  formatTradePlanLabel,
  maxAffordableExtractors,
  ROID_DURATION_MAX,
  ROID_DURATION_MIN,
  roidsOverlap,
  type StartConfig,
} from "@/lib/calculate-fastest-way-to-goal.ts";
import { cn } from "@/lib/utils/cn.ts";

// Shadcn components
import { Button } from "@/components/shadcn/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog.tsx";
import { Field, FieldLabel } from "@/components/shadcn/field.tsx";
import { RadioGroup, RadioGroupItem } from "@/components/shadcn/radio-group.tsx";
import { Input } from "@/components/shadcn/input.tsx";
import { Checkbox } from "@/components/shadcn/checkbox.tsx";
import { InputGroup, InputGroupInput } from "@/components/shadcn/input-group.tsx";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/shadcn/combobox.tsx";

const ROID_DURATION_ITEMS = Array.from({ length: ROID_DURATION_MAX - ROID_DURATION_MIN + 1 }, (_, i) => String(ROID_DURATION_MIN + i));
const ROID_DEFAULT_DURATION = 5;
const CATASTROPHE_DURATION_ITEMS = Array.from({ length: CATASTROPHE_DURATION_MAX - CATASTROPHE_DURATION_MIN + 1 }, (_, i) =>
  String(CATASTROPHE_DURATION_MIN + i)
);

export type PlanEntryDialogMode = "add" | "edit";

type TechTarget = {
  kind: "tech";
  tech: TechTreeEntry;
  defaultTick: number;
};

type CountableTarget = {
  kind: "unit" | "recon";
  name: string;
  ticks: number;
  cost: { met: number; kris: number };
  dependencies: string[];
  defaultTick: number;
  defaultCount: number;
  maxCount: number;
};

/** Unified asteroids + extractors dialog target. */
type EconomyTarget = {
  kind: "economy";
  defaultTick: number;
  defaultAsteroids: number;
  defaultExtractorsMet: number;
  defaultExtractorsKris: number;
  /** Free slots before this entry's own asteroids/extractors. */
  freeSlots: number;
  asteroidsOwned: number;
  alreadyBuilt: number;
  /** Whether Observatorium is available for asteroid part. */
  canAsteroids: boolean;
  /** Whether Extraktor tech is available. */
  canExtractors: boolean;
  costKrisPerAsteroid: number;
};

type CustomTarget = {
  kind: "custom";
  defaultTick: number;
  defaultLabel: string;
  defaultMet: number;
  defaultKris: number;
};

type TradeTarget = {
  kind: "trade";
  defaultTick: number;
  defaultGive: "met" | "kris";
  defaultGiveAmount: number;
  defaultReceiveAmount: number;
};

export type OccupiedRoid = {
  startTick: number;
  duration: number;
  targetMet: number;
  targetKris: number;
};

type RoidTarget = {
  kind: "roid";
  defaultTick: number;
  defaultTargetMet: number;
  defaultTargetKris: number;
  defaultDuration: number;
  defaultMulti?: RoidMulti;
  occupiedRoids: OccupiedRoid[];
};

type CatastropheTarget = {
  kind: "catastrophe";
  defaultTick: number;
  defaultDuration: number;
};

type AttackTarget = {
  kind: "attack";
  defaultTick: number;
  defaultDuration: number;
  defaultRoidDuration: number;
  defaultTargetMet: number;
  defaultTargetKris: number;
  defaultMulti?: RoidMulti;
  defaultNoReturn: boolean;
  /** Kampffenster anderer Roids (Start = erster Kampftick). */
  occupiedRoids: OccupiedRoid[];
};

type SnapshotTarget = {
  kind: "snapshot";
  defaultTick: number;
  defaultMet: number;
  defaultKris: number;
  defaultExtractorsMet: number;
  defaultExtractorsKris: number;
  defaultAsteroids: number;
};

export type PlanEntryDialogTarget =
  | TechTarget
  | CountableTarget
  | EconomyTarget
  | CustomTarget
  | TradeTarget
  | RoidTarget
  | CatastropheTarget
  | AttackTarget
  | SnapshotTarget;

export type PlanEntryDialogSubmit = {
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
  /** Nur Roid/Angriffsflug: weitere Angreifer; fehlt = alleine. */
  multi?: RoidMulti;
  /** Nur Angriffsflug: kein Rückflug. */
  noReturn?: boolean;
  /** Nur Angriffsflug: Roid-Ticks (die letzten Kampfticks). */
  roidDuration?: number;
};

export type PlanEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PlanEntryDialogMode;
  target: PlanEntryDialogTarget | null;
  /** Für Uhrzeit-Anzeige von Start- und End-Tick. */
  startCfg: StartConfig;
  /** Existing entry when editing. */
  entry?: PlanEntry | null;
  onSubmit: (values: PlanEntryDialogSubmit) => void;
  onRemove?: () => void;
  /** Dynamic max/count when tick changes (units/recon). */
  resolveMaxCount?: (startTick: number) => number;
  resolveEconomyAtTick?: (startTick: number) => {
    freeSlots: number;
    asteroids: number;
    alreadyBuilt: number;
    /** Ressourcen am Tick (ggf. mit Edit-Refund des aktuellen Eintrags). */
    met: number;
    kris: number;
  };
};

export function PlanEntryDialog({
  open,
  onOpenChange,
  mode,
  target,
  startCfg,
  entry,
  onSubmit,
  onRemove,
  resolveMaxCount,
  resolveEconomyAtTick,
}: PlanEntryDialogProps) {
  /** Wert im Tick-Feld: Start- oder End-Tick, je nach `tickInputMode`. */
  const [tickInput, setTickInput] = useState(0);
  const [count, setCount] = useState(1);
  const [asteroidCount, setAsteroidCount] = useState(0);
  const [extractorMetCount, setExtractorMetCount] = useState(0);
  const [extractorKrisCount, setExtractorKrisCount] = useState(0);
  const [label, setLabel] = useState("");
  const [met, setMet] = useState(0);
  const [kris, setKris] = useState(0);
  const [give, setGive] = useState<"met" | "kris">("met");
  const [giveAmount, setGiveAmount] = useState(0);
  const [receiveAmount, setReceiveAmount] = useState(0);
  const [targetMet, setTargetMet] = useState(0);
  const [targetKris, setTargetKris] = useState(0);
  const [duration, setDuration] = useState(ROID_DURATION_MIN);
  const [multiEnabled, setMultiEnabled] = useState(false);
  const [ownCleptors, setOwnCleptors] = useState(0);
  const [coAttackers, setCoAttackers] = useState<RoidCoAttacker[]>([]);
  const [noReturn, setNoReturn] = useState(false);
  const [attackRoidDuration, setAttackRoidDuration] = useState(ROID_DURATION_MIN);
  /** Ob das Tick-Feld den Start- oder den End-Tick bearbeitet (bleibt zwischen Dialogen erhalten). */
  const [tickInputMode, setTickInputMode] = useState<"start" | "end">("start");
  // Nur beim Öffnen gelesen: Umschalten soll den Feldwert nicht neu setzen.
  const tickInputModeRef = useRef(tickInputMode);
  tickInputModeRef.current = tickInputMode;

  const entryDuration = target ? targetDuration(target, duration, noReturn) : 0;
  const editsEndTick = entryDuration > 0 && tickInputMode === "end";
  const startTick = editsEndTick ? Math.max(0, tickInput - entryDuration) : tickInput;
  const endTick = startTick + entryDuration;

  useEffect(() => {
    if (!open || !target) return;
    if (mode === "edit" && entry) {
      const entryDur =
        entry.kind === "roid" || entry.kind === "catastrophe" || entry.kind === "attack"
          ? targetDuration(target, entry.duration, entry.kind === "attack" && !!entry.noReturn)
          : targetDuration(target, 0, false);
      setTickInput(tickInputModeRef.current === "end" && entryDur > 0 ? entry.startTick + entryDur : entry.startTick);
      if (entry.kind === "economy") {
        setAsteroidCount(Math.max(0, entry.asteroids));
        setExtractorMetCount(Math.max(0, entry.extractorsMet));
        setExtractorKrisCount(Math.max(0, entry.extractorsKris));
        return;
      }
      if (entry.kind === "asteroids") {
        setAsteroidCount(Math.max(0, entry.count));
        setExtractorMetCount(0);
        setExtractorKrisCount(0);
        return;
      }
      if (entry.kind === "extractors") {
        setAsteroidCount(0);
        setExtractorMetCount(entry.resource === "met" ? Math.max(0, entry.count) : 0);
        setExtractorKrisCount(entry.resource === "kris" ? Math.max(0, entry.count) : 0);
        return;
      }
      if (entry.kind === "custom") {
        setLabel(entry.label);
        setMet(Math.max(0, entry.cost.met));
        setKris(Math.max(0, entry.cost.kris));
        return;
      }
      if (entry.kind === "trade") {
        setGive(entry.give);
        setGiveAmount(Math.max(0, entry.giveAmount));
        setReceiveAmount(Math.max(0, entry.receiveAmount));
        return;
      }
      if (entry.kind === "roid" || entry.kind === "attack") {
        setTargetMet(Math.max(0, entry.targetMet));
        setTargetKris(Math.max(0, entry.targetKris));
        setDuration(Math.min(ROID_DURATION_MAX, Math.max(ROID_DURATION_MIN, entry.duration)));
        setNoReturn(entry.kind === "attack" && !!entry.noReturn);
        if (entry.kind === "attack") {
          setAttackRoidDuration(clampAttackRoidDuration(entry.roidDuration, entry.duration));
        }
        setMultiEnabled(!!entry.multi);
        setOwnCleptors(entry.multi?.ownCleptors ?? 0);
        setCoAttackers(entry.multi?.attackers.map((a) => ({ ...a })) ?? []);
        return;
      }
      if (entry.kind === "catastrophe") {
        setDuration(Math.min(CATASTROPHE_DURATION_MAX, Math.max(CATASTROPHE_DURATION_MIN, entry.duration)));
        return;
      }
      if (entry.kind === "snapshot") {
        setMet(Math.max(0, entry.met));
        setKris(Math.max(0, entry.kris));
        setExtractorMetCount(Math.max(0, entry.extractorsMet));
        setExtractorKrisCount(Math.max(0, entry.extractorsKris));
        setAsteroidCount(Math.max(0, entry.asteroids));
        return;
      }
      if ("count" in entry) setCount(entry.count);
      return;
    }

    // Default ist immer der aktuelle/ausgewählte Tick, egal ob Start oder Ende.
    setTickInput(target.defaultTick);
    if (target.kind === "unit" || target.kind === "recon") {
      setCount(Math.max(1, target.defaultCount));
    } else if (target.kind === "economy") {
      setAsteroidCount(Math.max(0, target.defaultAsteroids));
      setExtractorMetCount(Math.max(0, target.defaultExtractorsMet));
      setExtractorKrisCount(Math.max(0, target.defaultExtractorsKris));
    } else if (target.kind === "custom") {
      setLabel(target.defaultLabel);
      setMet(Math.max(0, target.defaultMet));
      setKris(Math.max(0, target.defaultKris));
    } else if (target.kind === "trade") {
      setGive(target.defaultGive);
      setGiveAmount(Math.max(0, target.defaultGiveAmount));
      setReceiveAmount(Math.max(0, target.defaultReceiveAmount));
    } else if (target.kind === "snapshot") {
      setMet(Math.max(0, target.defaultMet));
      setKris(Math.max(0, target.defaultKris));
      setExtractorMetCount(Math.max(0, target.defaultExtractorsMet));
      setExtractorKrisCount(Math.max(0, target.defaultExtractorsKris));
      setAsteroidCount(Math.max(0, target.defaultAsteroids));
    } else if (target.kind === "catastrophe") {
      setDuration(Math.min(CATASTROPHE_DURATION_MAX, Math.max(CATASTROPHE_DURATION_MIN, target.defaultDuration)));
    } else if (target.kind === "roid" || target.kind === "attack") {
      setNoReturn(target.kind === "attack" && target.defaultNoReturn);
      if (target.kind === "attack") {
        setAttackRoidDuration(clampAttackRoidDuration(target.defaultRoidDuration, target.defaultDuration));
      }
      setTargetMet(Math.max(0, target.defaultTargetMet));
      setTargetKris(Math.max(0, target.defaultTargetKris));
      setDuration(Math.min(ROID_DURATION_MAX, Math.max(ROID_DURATION_MIN, target.defaultDuration)));
      setMultiEnabled(!!target.defaultMulti);
      setOwnCleptors(target.defaultMulti?.ownCleptors ?? 0);
      setCoAttackers(target.defaultMulti?.attackers.map((a) => ({ ...a })) ?? []);
    } else {
      setCount(1);
    }
  }, [open, target, mode, entry]);

  const liveMax = useMemo(() => {
    if (!target) return 1;
    if (resolveMaxCount) return Math.max(0, resolveMaxCount(startTick));
    if (target.kind === "unit" || target.kind === "recon") return target.maxCount;
    return 999;
  }, [target, startTick, resolveMaxCount]);
  // Einträge starten fest an ihrem Tick: mehr als bezahlbar zieht das Konto ins Minus. 1 Stück geht immer.
  const countLimit = Math.max(1, liveMax);

  const liveEconomy = useMemo(() => {
    if (!target || (target.kind !== "economy" && target.kind !== "catastrophe")) return null;
    if (resolveEconomyAtTick) return resolveEconomyAtTick(startTick);
    if (target.kind === "catastrophe") {
      return { freeSlots: 0, asteroids: 0, alreadyBuilt: 0, met: 0, kris: 0 };
    }
    return {
      freeSlots: target.freeSlots,
      asteroids: target.asteroidsOwned,
      alreadyBuilt: target.alreadyBuilt,
      met: 0,
      kris: 0,
    };
  }, [target, startTick, resolveEconomyAtTick]);

  const liveTradeRes = useMemo(() => {
    if (!target || target.kind !== "trade") return null;
    if (resolveEconomyAtTick) {
      const snap = resolveEconomyAtTick(startTick);
      return { met: snap.met, kris: snap.kris };
    }
    return { met: 0, kris: 0 };
  }, [target, startTick, resolveEconomyAtTick]);

  const unitTotalCost = useMemo(() => {
    if (!target || (target.kind !== "unit" && target.kind !== "recon")) return null;
    const n = Math.max(0, count);
    return {
      met: target.cost.met * n,
      kris: target.cost.kris * n,
    };
  }, [target, count]);

  const economyCosts = useMemo(() => {
    if (!target || target.kind !== "economy" || !liveEconomy) return null;
    const a = Math.max(0, asteroidCount);
    const e = Math.max(0, extractorMetCount + extractorKrisCount);
    const costPerAst = target.costKrisPerAsteroid || ASTEROID_COST.kris;
    const slotsFromNew = a * ASTEROID_SLOT_CAPACITY;
    const freeAfterAst = liveEconomy.freeSlots + slotsFromNew;
    const alreadyBuilt = liveEconomy.alreadyBuilt;
    const totalKris = a * costPerAst;
    // Asteroiden zuerst zahlen → restliches Metall bestimmt Max-Extraktoren.
    const krisAfterAst = Math.max(0, liveEconomy.kris - totalKris);
    const maxExtractors = maxAffordableExtractors({
      met: liveEconomy.met,
      kris: krisAfterAst,
      alreadyBuilt,
      asteroids: liveEconomy.asteroids + a,
      slots: alreadyBuilt + freeAfterAst,
      allowBuyAsteroids: false,
    });
    const nextCost = e > 0 ? extractorUnitCost(alreadyBuilt + 1) : 0;
    const totalMet = extractorBatchCost(alreadyBuilt, e);
    return {
      alreadyBuilt,
      freeAfterAst,
      nextCost,
      totalMet,
      totalKris,
      maxExtractors,
    };
  }, [target, liveEconomy, asteroidCount, extractorMetCount, extractorKrisCount]);

  const roidMulti = useMemo<RoidMulti | undefined>(
    () => ((target?.kind === "roid" || target?.kind === "attack") && multiEnabled ? { ownCleptors, attackers: coAttackers } : undefined),
    [target, multiEnabled, ownCleptors, coAttackers]
  );

  // Beim Angriffsflug wird nur in den letzten `roidTicks` Kampfticks geroidet.
  const roidTicks = target?.kind === "attack" ? Math.min(attackRoidDuration, duration) : duration;

  const roidLoot = useMemo(
    () => (roidMulti ? computeRoidLoot(targetMet, targetKris, roidTicks, roidMulti) : null),
    [roidMulti, targetMet, targetKris, roidTicks]
  );

  function updateCoAttacker(index: number, patch: Partial<RoidCoAttacker>) {
    setCoAttackers((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  if (!target) return null;

  // Erster Roid-Tick; beim Angriffsflug zählt nur ein Kampf mit Ziel-Exen als Roid.
  const roidStartTick = target.kind === "attack" ? attackRoidStartTick(startTick, duration, roidTicks) : startTick;

  const timeRows =
    entryDuration > 0 ? (
      <>
        <dt className="text-muted-foreground">Start</dt>
        <dd className="tabular-nums">{clockLabel(startCfg, startTick)}</dd>
        {target.kind === "attack" && (
          <>
            <dt className="text-muted-foreground">Ankunft</dt>
            <dd className="tabular-nums">{clockLabel(startCfg, startTick + ATTACK_FLIGHT_TICKS)}</dd>
            <dt className="text-muted-foreground">Kampf</dt>
            <dd className="tabular-nums">
              {clockLabel(startCfg, attackFirstCombatTick(startTick))} – {clockLabel(startCfg, startTick + ATTACK_FLIGHT_TICKS + duration)}{" "}
              (Tick {attackFirstCombatTick(startTick)}–{startTick + ATTACK_FLIGHT_TICKS + duration})
            </dd>
            {(targetMet > 0 || targetKris > 0) && (
              <>
                <dt className="text-muted-foreground">Roid</dt>
                <dd className="tabular-nums">
                  {clockLabel(startCfg, roidStartTick)} – {clockLabel(startCfg, startTick + ATTACK_FLIGHT_TICKS + duration)} (Tick{" "}
                  {roidStartTick}–{startTick + ATTACK_FLIGHT_TICKS + duration})
                </dd>
              </>
            )}
          </>
        )}
        <dt className="text-muted-foreground">{target.kind === "attack" && !noReturn ? "Rückkehr" : "Ende"}</dt>
        <dd className="tabular-nums">{clockLabel(startCfg, endTick)}</dd>
      </>
    ) : (
      <>
        <dt className="text-muted-foreground">Zeitpunkt</dt>
        <dd className="tabular-nums">{clockLabel(startCfg, startTick)}</dd>
      </>
    );

  function lengthField(labelText: string, value: number, max: number, apply: (n: number) => void) {
    const items = ROID_DURATION_ITEMS.slice(0, max);
    return (
      <Field className="w-32">
        <FieldLabel>{labelText}</FieldLabel>
        <Combobox
          items={items}
          value={String(value)}
          onValueChange={(v) => {
            if (v == null) return;
            const n = Number(v);
            if (n >= 1 && n <= max) apply(n);
          }}
        >
          <ComboboxInput showTrigger className="w-32" />
          <ComboboxContent>
            <ComboboxList>
              {items.map((item) => (
                <ComboboxItem key={item} value={item}>
                  {item} {item === "1" ? "Tick" : "Ticks"}
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
    );
  }

  const tickField = (
    <Field className={target.kind === "economy" ? "w-full" : "w-auto"}>
      <FieldLabel htmlFor="plan-start-tick">{editsEndTick ? "End-Tick" : "Start-Tick"}</FieldLabel>
      <div className="flex items-center gap-2">
        <InputGroup className={target.kind === "economy" ? undefined : "w-28"}>
          <InputGroupInput
            id="plan-start-tick"
            type="number"
            min={0}
            value={tickInput}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setTickInput(Math.max(0, Math.floor(n)));
            }}
            className="tabular-nums"
          />
        </InputGroup>
        {entryDuration > 0 && (
          <>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {editsEndTick ? `Start: Tick ${startTick}` : `Ende: Tick ${endTick}`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={editsEndTick ? "Start-Tick angeben" : "End-Tick angeben"}
              aria-label={editsEndTick ? "Start-Tick angeben" : "End-Tick angeben"}
              onClick={() => setTickInputMode(editsEndTick ? "start" : "end")}
            >
              <ArrowLeftRight />
            </Button>
          </>
        )}
      </div>
    </Field>
  );

  const title = (() => {
    if (target.kind === "tech") return target.tech.name;
    if (target.kind === "unit" || target.kind === "recon") return target.name;
    if (target.kind === "custom") return label.trim() || "Custom-Ausgabe";
    if (target.kind === "trade") {
      return giveAmount > 0 || receiveAmount > 0 ? formatTradePlanLabel(give, giveAmount, receiveAmount) : "Trade";
    }
    if (target.kind === "roid") {
      return targetMet > 0 || targetKris > 0 ? formatRoidPlanLabel(targetMet, targetKris) : "Roid";
    }
    if (target.kind === "catastrophe") {
      return formatCatastrophePlanLabel(duration);
    }
    if (target.kind === "attack") {
      return formatAttackPlanLabel({ duration, targetMet, targetKris });
    }
    if (target.kind === "snapshot") {
      return formatSnapshotPlanLabel({
        met,
        kris,
        extractorsMet: extractorMetCount,
        extractorsKris: extractorKrisCount,
        asteroids: asteroidCount,
      });
    }
    return "Asteroiden & Extraktoren";
  })();

  const checksRoidOverlap = target.kind === "roid" || (target.kind === "attack" && (targetMet > 0 || targetKris > 0));
  const overlappingRoid =
    checksRoidOverlap && (target.kind === "roid" || target.kind === "attack")
      ? (target.occupiedRoids.find((r) => roidsOverlap(roidStartTick, roidTicks, r.startTick, r.duration)) ?? null)
      : null;

  const canSubmit = (() => {
    if (startTick < 0) return false;
    if (target.kind === "tech") return true;
    if (target.kind === "unit" || target.kind === "recon") {
      return count >= 1 && count <= countLimit;
    }
    if (target.kind === "economy") {
      const a = Math.max(0, asteroidCount);
      const metEx = Math.max(0, extractorMetCount);
      const krisEx = Math.max(0, extractorKrisCount);
      if (a <= 0 && metEx <= 0 && krisEx <= 0) return false;
      if (a > 0 && !target.canAsteroids) return false;
      if ((metEx > 0 || krisEx > 0) && !target.canExtractors) return false;
      return true;
    }
    if (target.kind === "custom") {
      return label.trim().length > 0 && met >= 0 && kris >= 0;
    }
    if (target.kind === "trade") {
      return giveAmount > 0 || receiveAmount > 0;
    }
    if (target.kind === "roid") {
      if (targetMet <= 0 && targetKris <= 0) return false;
      if (duration < ROID_DURATION_MIN || duration > ROID_DURATION_MAX) return false;
      if (multiEnabled && ownCleptors <= 0) return false;
      return !overlappingRoid;
    }
    if (target.kind === "catastrophe") {
      return duration >= CATASTROPHE_DURATION_MIN && duration <= CATASTROPHE_DURATION_MAX;
    }
    if (target.kind === "attack") {
      if (duration < ATTACK_DURATION_MIN || duration > ATTACK_DURATION_MAX) return false;
      if (multiEnabled && ownCleptors <= 0) return false;
      return !overlappingRoid;
    }
    if (target.kind === "snapshot") {
      return met >= 0 && kris >= 0 && extractorMetCount >= 0 && extractorKrisCount >= 0 && asteroidCount >= 0;
    }
    return false;
  })();

  function handleSubmit() {
    if (!canSubmit || !target) return;
    if (target.kind === "tech") {
      onSubmit({ startTick });
    } else if (target.kind === "economy") {
      onSubmit({
        startTick,
        asteroids: Math.max(0, asteroidCount),
        extractorsMet: Math.max(0, extractorMetCount),
        extractorsKris: Math.max(0, extractorKrisCount),
      });
    } else if (target.kind === "custom") {
      onSubmit({
        startTick,
        label: label.trim(),
        cost: { met: Math.max(0, met), kris: Math.max(0, kris) },
      });
    } else if (target.kind === "trade") {
      onSubmit({
        startTick,
        give,
        giveAmount: Math.max(0, giveAmount),
        receiveAmount: Math.max(0, receiveAmount),
      });
    } else if (target.kind === "roid") {
      onSubmit({
        startTick,
        targetMet: Math.max(0, targetMet),
        targetKris: Math.max(0, targetKris),
        duration,
        multi: roidMulti,
      });
    } else if (target.kind === "attack") {
      onSubmit({
        startTick,
        targetMet: Math.max(0, targetMet),
        targetKris: Math.max(0, targetKris),
        duration,
        roidDuration: roidTicks,
        multi: roidMulti,
        noReturn,
      });
    } else if (target.kind === "catastrophe") {
      onSubmit({ startTick, duration });
    } else if (target.kind === "snapshot") {
      onSubmit({
        startTick,
        cost: { met: Math.max(0, met), kris: Math.max(0, kris) },
        extractorsMet: Math.max(0, extractorMetCount),
        extractorsKris: Math.max(0, extractorKrisCount),
        asteroids: Math.max(0, asteroidCount),
      });
    } else {
      onSubmit({ startTick, count: Math.max(1, count) });
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={target.kind === "roid" || target.kind === "attack" ? "sm:max-w-xl" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{mode === "edit" ? "Plan-Eintrag bearbeiten" : "Zum Plan hinzufügen"}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          {target.kind !== "tech" && target.kind !== "unit" && target.kind !== "recon" && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{timeRows}</dl>
          )}

          {target.kind === "tech" && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {timeRows}
              <dt className="text-muted-foreground">Typ</dt>
              <dd>{target.tech.type === "building" ? "Gebäude" : "Forschung"}</dd>
              <dt className="text-muted-foreground">Dauer</dt>
              <dd className="tabular-nums">{target.tech.ticks} Ticks</dd>
              <dt className="text-muted-foreground">Kosten</dt>
              <dd className="tabular-nums">
                {formatRes(target.tech.cost.met)} M · {formatRes(target.tech.cost.kris)} K
              </dd>
              <dt className="text-muted-foreground">Voraussetzungen</dt>
              <dd>{target.tech.dependencies.length ? target.tech.dependencies.join(", ") : "—"}</dd>
            </dl>
          )}

          {(target.kind === "unit" || target.kind === "recon") && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {timeRows}
              <dt className="text-muted-foreground">Dauer / Stück</dt>
              <dd className="tabular-nums">{target.ticks} Ticks</dd>
              <dt className="text-muted-foreground">Kosten / Stück</dt>
              <dd className="tabular-nums">
                {formatRes(target.cost.met)} M · {formatRes(target.cost.kris)} K
              </dd>
              {unitTotalCost && (
                <>
                  <dt className="text-muted-foreground">Gesamtkosten</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {formatRes(unitTotalCost.met)} M · {formatRes(unitTotalCost.kris)} K
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Voraussetzungen</dt>
              <dd>{target.dependencies.length ? target.dependencies.join(", ") : "—"}</dd>
            </dl>
          )}

          {target.kind === "economy" && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="tabular-nums">
                Besitzt: {liveEconomy?.asteroids ?? 0} Asteroiden · {liveEconomy?.alreadyBuilt ?? 0} Extraktoren ·{" "}
                {liveEconomy?.freeSlots ?? 0} freie Slots
              </p>
              {economyCosts && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt>Asteroiden-Kosten</dt>
                  <dd className="font-medium text-foreground tabular-nums">{formatRes(economyCosts.totalKris)} K</dd>
                  <dt>Extraktor-Kosten</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {formatRes(economyCosts.totalMet)} M
                    {extractorMetCount + extractorKrisCount > 0 ? ` (nächster ${formatRes(economyCosts.nextCost)} M)` : ""}
                  </dd>
                  <dt>Slots nach Asteroiden</dt>
                  <dd className="font-medium text-foreground tabular-nums">{economyCosts.freeAfterAst}</dd>
                </dl>
              )}
              {extractorMetCount + extractorKrisCount > 0 &&
                economyCosts &&
                extractorMetCount + extractorKrisCount > economyCosts.maxExtractors && (
                  <p className="text-amber-500">
                    Mehr Extraktoren als Slots/Metall bei diesem Tick — was das Metall nicht hergibt, wird in den Folgeticks gebaut. Ohne
                    Asteroidenplatz liefern sie keine Rohstoffe.
                  </p>
                )}
              {asteroidCount > 0 && !target.canAsteroids && <p className="text-amber-500">Observatorium fehlt im Plan.</p>}
              {(extractorMetCount > 0 || extractorKrisCount > 0) && !target.canExtractors && (
                <p className="text-amber-500">Extraktor-Tech fehlt im Plan.</p>
              )}
            </div>
          )}

          {target.kind === "custom" && (
            <Field className="w-full">
              <FieldLabel htmlFor="plan-custom-label">Label</FieldLabel>
              <Input
                id="plan-custom-label"
                type="text"
                value={label}
                placeholder="z.B. Scans, Umzug"
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          )}

          {target.kind === "snapshot" && (
            <p className="text-xs text-muted-foreground">
              Ab diesem Tick gelten diese Werte statt der berechneten Rohstoffe und Extraktoren. Einkommen der neuen Exen startet im
              nächsten Tick.
            </p>
          )}

          {target.kind === "catastrophe" && (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <p>
                Pro Tick 10% der restlichen eigenen Extraktoren (immer abgerundet). Bestand bei Tick {startTick}:{" "}
                {liveEconomy?.alreadyBuilt ?? "—"} Extraktoren.
              </p>
            </div>
          )}

          {(target.kind === "roid" || target.kind === "attack") && (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <p>
                Pro Tick 10% der restlichen Ziel-Exen (immer abgerundet). Ertrag ab dem nächsten Tick, Asteroidenplätze werden gebraucht.
              </p>
              {overlappingRoid && (
                <p className="text-amber-500">
                  Überlappt mit {formatRoidPlanLabel(overlappingRoid.targetMet, overlappingRoid.targetKris)}.
                </p>
              )}
            </div>
          )}

          <div
            className={
              target.kind === "economy" ||
              target.kind === "trade" ||
              target.kind === "snapshot" ||
              target.kind === "roid" ||
              target.kind === "attack"
                ? "flex flex-col gap-3"
                : "flex flex-wrap items-end gap-3"
            }
          >
            {target.kind !== "trade" && target.kind !== "roid" && target.kind !== "attack" && tickField}

            {(target.kind === "unit" || target.kind === "recon") && (
              <Field className="w-28">
                <FieldLabel htmlFor="plan-count">Anzahl</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="plan-count"
                    type="number"
                    min={1}
                    max={countLimit}
                    value={count}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setCount(Math.max(1, Math.floor(n)));
                    }}
                    className="tabular-nums"
                  />
                </InputGroup>
              </Field>
            )}

            {target.kind === "trade" && (
              <>
                <div className="flex w-full flex-wrap items-end gap-3">
                  {tickField}
                  <Field className="min-w-40 flex-1">
                    <FieldLabel>Rohstoff</FieldLabel>
                    <RadioGroup
                      value={give}
                      onValueChange={(value) => {
                        if (value === "met" || value === "kris") setGive(value);
                      }}
                      className="flex h-7 items-center gap-4"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="met" />
                        Metall
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="kris" />
                        Kristall
                      </label>
                    </RadioGroup>
                  </Field>
                </div>
                <div className="flex w-full flex-wrap items-end gap-3">
                  <Field className="min-w-28 flex-1">
                    <FieldLabel htmlFor="plan-trade-from">Menge</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="plan-trade-from"
                        type="number"
                        min={0}
                        value={giveAmount}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setGiveAmount(Math.max(0, Math.floor(n)));
                        }}
                        className="tabular-nums"
                      />
                    </InputGroup>
                  </Field>
                  <Field className="min-w-28 flex-1">
                    <FieldLabel htmlFor="plan-trade-to">Nach Rohstoff ({give === "met" ? "Kristall" : "Metall"})</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="plan-trade-to"
                        type="number"
                        min={0}
                        value={receiveAmount}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setReceiveAmount(Math.max(0, Math.floor(n)));
                        }}
                        className="tabular-nums"
                      />
                    </InputGroup>
                  </Field>
                </div>
              </>
            )}

            {target.kind === "custom" && (
              <>
                <Field className="w-28">
                  <FieldLabel htmlFor="plan-custom-met">Metall</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-custom-met"
                      type="number"
                      min={0}
                      value={met}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setMet(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field className="w-28">
                  <FieldLabel htmlFor="plan-custom-kris">Kristall</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-custom-kris"
                      type="number"
                      min={0}
                      value={kris}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setKris(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
              </>
            )}

            {target.kind === "snapshot" && (
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="plan-snap-met">Metall</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-snap-met"
                      type="number"
                      min={0}
                      value={met}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setMet(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-snap-met-ex">Met-Exen</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-snap-met-ex"
                      type="number"
                      min={0}
                      value={extractorMetCount}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setExtractorMetCount(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-snap-kris">Kristall</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-snap-kris"
                      type="number"
                      min={0}
                      value={kris}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setKris(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-snap-kris-ex">Kris-Exen</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-snap-kris-ex"
                      type="number"
                      min={0}
                      value={extractorKrisCount}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setExtractorKrisCount(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field className="col-span-2">
                  <FieldLabel htmlFor="plan-snap-ast">Asteroiden</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-snap-ast"
                      type="number"
                      min={0}
                      value={asteroidCount}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setAsteroidCount(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
              </div>
            )}

            {target.kind === "catastrophe" && (
              <Field className="w-32">
                <FieldLabel>Angriffslänge</FieldLabel>
                <Combobox
                  items={CATASTROPHE_DURATION_ITEMS}
                  value={String(duration)}
                  onValueChange={(value) => {
                    if (value == null) return;
                    const n = Number(value);
                    if (n >= CATASTROPHE_DURATION_MIN && n <= CATASTROPHE_DURATION_MAX) {
                      setDuration(n);
                    }
                  }}
                >
                  <ComboboxInput showTrigger className="w-32" />
                  <ComboboxContent>
                    <ComboboxList>
                      {CATASTROPHE_DURATION_ITEMS.map((item) => (
                        <ComboboxItem key={item} value={item}>
                          {item} {item === "1" ? "Tick" : "Ticks"}
                        </ComboboxItem>
                      ))}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>
            )}

            {(target.kind === "roid" || target.kind === "attack") && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  {tickField}
                  {target.kind === "roid" && lengthField("Angriffslänge", duration, ROID_DURATION_MAX, setDuration)}
                  {target.kind === "attack" && (
                    <label className="flex h-7 items-center gap-2 text-xs">
                      <Checkbox checked={noReturn} onCheckedChange={(checked) => setNoReturn(checked)} />
                      Ohne Rückflug
                    </label>
                  )}
                </div>
                {target.kind === "attack" && (
                  <div className="flex flex-wrap items-end gap-3">
                    {lengthField("Angriffslänge", duration, ATTACK_DURATION_MAX, setDuration)}
                    {lengthField("Roidlänge", roidTicks, duration, setAttackRoidDuration)}
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-3">
                  <Field className="w-28">
                    <FieldLabel htmlFor="plan-roid-met">Target M-Exen</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="plan-roid-met"
                        type="number"
                        min={0}
                        value={targetMet}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setTargetMet(Math.max(0, Math.floor(n)));
                        }}
                        className="tabular-nums"
                      />
                    </InputGroup>
                  </Field>
                  <Field className="w-28">
                    <FieldLabel htmlFor="plan-roid-kris">Target K-Exen</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="plan-roid-kris"
                        type="number"
                        min={0}
                        value={targetKris}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setTargetKris(Math.max(0, Math.floor(n)));
                        }}
                        className="tabular-nums"
                      />
                    </InputGroup>
                  </Field>
                  {multiEnabled && (
                    <Field className="w-32">
                      <FieldLabel htmlFor="plan-roid-own-clep">Eigene Cleptoren</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="plan-roid-own-clep"
                          type="number"
                          min={0}
                          value={ownCleptors}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            setOwnCleptors(Math.max(0, Math.floor(n)));
                          }}
                          className="tabular-nums"
                        />
                      </InputGroup>
                    </Field>
                  )}
                </div>
                <div className="flex basis-full flex-col gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={multiEnabled}
                      onCheckedChange={(checked) => {
                        setMultiEnabled(checked);
                        if (checked && coAttackers.length === 0) {
                          setCoAttackers([{ startOffset: 0, duration: ROID_DEFAULT_DURATION, cleptors: 0 }]);
                        }
                      }}
                    />
                    Mehr als ein Angreifer
                  </label>
                  {multiEnabled && (
                    <div className="flex flex-col gap-2">
                      {coAttackers.length > 0 && (
                        <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-2 gap-y-1 text-xs">
                          <span />
                          <span className="text-muted-foreground">Start (+Ticks)</span>
                          <span className="text-muted-foreground">Dauer</span>
                          <span className="text-muted-foreground">Cleptoren</span>
                          <span />
                          {coAttackers.map((a, i) => (
                            <AttackerRow
                              key={i}
                              index={i}
                              attacker={a}
                              onChange={(patch) => updateCoAttacker(i, patch)}
                              onRemove={() => setCoAttackers((prev) => prev.filter((_, j) => j !== i))}
                            />
                          ))}
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() =>
                          setCoAttackers((prev) => [...prev, { startOffset: 0, duration: ROID_DEFAULT_DURATION, cleptors: 0 }])
                        }
                      >
                        <Plus data-icon="inline-start" />
                        Angreifer
                      </Button>
                      {roidLoot && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {ownCleptors <= 0 ? (
                            <span className="text-amber-500">Eigene Cleptoren angeben.</span>
                          ) : (
                            <>
                              Ich klaue <span className="font-medium text-foreground">{formatRoidShare(roidLoot)}</span> der erbeuteten Exen
                              ({roidLoot.own.met} M / {roidLoot.own.kris} K von {roidLoot.total.met} M / {roidLoot.total.kris} K).
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {target.kind === "economy" && (
              <div className="grid grid-cols-3 gap-3">
                <Field>
                  <FieldLabel htmlFor="plan-asteroids">Asteroiden</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-asteroids"
                      type="number"
                      min={0}
                      disabled={!target.canAsteroids}
                      value={asteroidCount}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setAsteroidCount(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-extractors-met">Met-Exen</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-extractors-met"
                      type="number"
                      min={0}
                      disabled={!target.canExtractors}
                      value={extractorMetCount}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setExtractorMetCount(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-extractors-kris">Kris-Exen</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="plan-extractors-kris"
                      type="number"
                      min={0}
                      disabled={!target.canExtractors}
                      value={extractorKrisCount}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setExtractorKrisCount(Math.max(0, Math.floor(n)));
                      }}
                      className="tabular-nums"
                    />
                  </InputGroup>
                </Field>
              </div>
            )}
          </div>

          {(target.kind === "unit" || target.kind === "recon") && (
            <p className={cn("text-[11px] tabular-nums", count > countLimit ? "text-destructive" : "text-muted-foreground")}>
              Max. bei Tick {startTick}: {liveMax}
              {count > countLimit ? " · Mehr als die Rohstoffe an diesem Tick erlauben." : null}
            </p>
          )}

          {target.kind === "economy" && economyCosts && (
            <p className="text-[11px] text-muted-foreground tabular-nums">
              Max. Extraktoren bei Tick {startTick} (Slots + Metall, nach Asteroiden-Kosten): {economyCosts.maxExtractors}
              {" · "}Slots: {economyCosts.freeAfterAst}
            </p>
          )}
          {target.kind === "trade" && liveTradeRes && giveAmount > (give === "met" ? liveTradeRes.met : liveTradeRes.kris) && (
            <p className="text-amber-500">
              Mehr {give === "met" ? "Metall" : "Kristall"} als bei Tick {startTick} verfügbar (
              {formatRes(give === "met" ? liveTradeRes.met : liveTradeRes.kris)}).
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {mode === "edit" && onRemove ? (
            <Button type="button" variant="destructive" onClick={onRemove}>
              Entfernen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {mode === "edit" ? "Speichern" : "Hinzufügen"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dauer eines Eintrags in Ticks (0 = sofort); `duration` nur für Roid/Katastrophe. */
function targetDuration(target: PlanEntryDialogTarget, duration: number, noReturn: boolean): number {
  if (target.kind === "tech") return target.tech.ticks;
  if (target.kind === "unit" || target.kind === "recon") return target.ticks;
  if (target.kind === "roid") {
    return Math.min(ROID_DURATION_MAX, Math.max(ROID_DURATION_MIN, duration));
  }
  if (target.kind === "catastrophe") {
    return Math.min(CATASTROPHE_DURATION_MAX, Math.max(CATASTROPHE_DURATION_MIN, duration));
  }
  if (target.kind === "attack") return attackTotalTicks(duration, noReturn);
  return 0;
}

function formatRoidShare(loot: ReturnType<typeof computeRoidLoot>): string {
  const own = loot.own.met + loot.own.kris;
  const total = loot.total.met + loot.total.kris;
  if (total <= 0) return "0%";
  return `${Math.round((own / total) * 100)}%`;
}

function AttackerRow({
  index,
  attacker,
  onChange,
  onRemove,
}: {
  index: number;
  attacker: RoidCoAttacker;
  onChange: (patch: Partial<RoidCoAttacker>) => void;
  onRemove: () => void;
}) {
  function numberInput(value: number, min: number, max: number | undefined, apply: (n: number) => void, label: string) {
    return (
      <InputGroup>
        <InputGroupInput
          type="number"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const clamped = Math.max(min, Math.floor(n));
            apply(max === undefined ? clamped : Math.min(max, clamped));
          }}
          className="tabular-nums"
        />
      </InputGroup>
    );
  }
  return (
    <>
      <span className="text-muted-foreground tabular-nums">#{index + 1}</span>
      {numberInput(attacker.startOffset, 0, ROID_DURATION_MAX - 1, (n) => onChange({ startOffset: n }), `Angreifer ${index + 1} Start`)}
      {numberInput(
        attacker.duration,
        ROID_DURATION_MIN,
        ROID_DURATION_MAX,
        (n) => onChange({ duration: n }),
        `Angreifer ${index + 1} Dauer`
      )}
      {numberInput(attacker.cleptors, 0, undefined, (n) => onChange({ cleptors: n }), `Angreifer ${index + 1} Cleptoren`)}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Angreifer ${index + 1} entfernen`} onClick={onRemove}>
        <X />
      </Button>
    </>
  );
}

/** Helper to build tech dialog target from TechTreeEntry. */
export function techDialogTarget(tech: TechTreeEntry, defaultTick: number): TechTarget {
  return { kind: "tech", tech, defaultTick };
}

export function shipDialogTarget(ship: Ship | Defense, defaultTick: number, defaultCount: number, maxCount: number): CountableTarget {
  return {
    kind: "unit",
    name: ship.name,
    ticks: ship.ticks,
    cost: ship.cost,
    dependencies: ship.dependencies,
    defaultTick,
    defaultCount,
    maxCount,
  };
}

export function reconDialogTarget(item: Utility, defaultTick: number, defaultCount: number, maxCount: number): CountableTarget {
  return {
    kind: "recon",
    name: item.name,
    ticks: item.ticks,
    cost: item.cost,
    dependencies: item.dependencies,
    defaultTick,
    defaultCount,
    maxCount,
  };
}
