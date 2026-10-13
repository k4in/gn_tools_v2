import { LoaderCircle } from "lucide-react";

/** Platzhalter, solange Daten aus Convex geladen werden. */
export function PageLoading() {
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center bg-background text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" aria-label="Lädt" />
    </main>
  );
}
