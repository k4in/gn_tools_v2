/** Ein neuer Plan-Eintrag, der aus der Sidebar in die Timeline gezogen wird. */
export type NewPlanItem =
  | { kind: "tech"; name: string }
  | { kind: "unit"; name: string }
  | { kind: "recon"; name: string }
  | { kind: "economy" }
  | { kind: "attack" }
  | { kind: "catastrophe" }
  | { kind: "trade" }
  | { kind: "custom" };

/** Daten eines Drag-Vorgangs: neuer Eintrag aus der Sidebar oder ein verschobener Timeline-Balken. */
export type PlanDragData =
  { source: "sidebar"; item: NewPlanItem; label: string } | { source: "timeline"; planEntryId: string; startTick: number; label: string };
