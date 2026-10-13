import { useMutation } from "convex/react";

import { api } from "@convex/_generated/api.ts";

/** Angesehenen und aktiven (gespielten) Slot setzen, beides mit optimistischem Update. */
export function useUserSlots() {
  const setActiveSlot = useMutation(api.users.setActiveSlot).withOptimisticUpdate((localStore, { key, slot }) => {
    const me = localStore.getQuery(api.users.me, { key });
    if (me) localStore.setQuery(api.users.me, { key }, { ...me, activeSlot: slot });
  });
  const setLiveSlot = useMutation(api.users.setLiveSlot).withOptimisticUpdate((localStore, { key, slot }) => {
    const me = localStore.getQuery(api.users.me, { key });
    if (me) localStore.setQuery(api.users.me, { key }, { ...me, liveSlot: slot });
  });

  return { setActiveSlot, setLiveSlot };
}
