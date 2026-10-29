import { useSyncExternalStore } from "react";

/** Ob die Media Query gerade zutrifft; aktualisiert sich bei Größenänderungen. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches
  );
}
