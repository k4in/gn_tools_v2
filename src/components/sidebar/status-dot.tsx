import { Coins } from "lucide-react";
import { cn } from "@/lib/utils/cn.ts";

export type StatusDotKind = "needed" | "blocked" | "underfunded";

/**
 * Status-Marker hinter einem Namen. Bewusst verschiedene Formen, nicht nur
 * Farben: benötigt = hohler Ring, Voraussetzung fehlt = roter Punkt,
 * Rohstoffe fehlen = rote Münzen.
 */
export function StatusDot({ kind }: { kind: StatusDotKind }) {
  if (kind === "underfunded") {
    return (
      <Coins aria-label="Rohstoffe reichen nicht" className="ml-1 inline-block size-3 shrink-0 align-[-2px] text-destructive">
        <title>Rohstoffe reichen nicht</title>
      </Coins>
    );
  }
  return (
    <span
      className={cn(
        "ml-1 inline-block size-1.5 shrink-0 rounded-full align-middle",
        kind === "needed" ? "ring-1 ring-foreground/80 ring-inset" : "bg-destructive"
      )}
      title={kind === "needed" ? "Für den Plan benötigt" : "Abhängigkeiten fehlen"}
    />
  );
}
