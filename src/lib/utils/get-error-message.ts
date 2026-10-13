import { ConvexError } from "convex/values";

/** Lesbare Meldung zu einem Fehler aus einer Convex-Funktion. */
export function getErrorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Etwas ist schiefgelaufen. Bitte versuche es erneut.";
}
