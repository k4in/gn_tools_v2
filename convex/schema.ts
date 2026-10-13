import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { planFields, planSlotValidator } from "./lib/validators.ts";

export default defineSchema({
  users: defineTable({
    keyHash: v.string(),
    name: v.string(),
    /** Zuletzt angesehener Plan-Slot. */
    activeSlot: planSlotValidator,
    /** Der Slot, der gerade gespielt wird; andere Tools rechnen damit. */
    liveSlot: v.union(planSlotValidator, v.null()),
  }).index("by_key_hash", ["keyHash"]),
  plans: defineTable({
    userId: v.id("users"),
    slot: planSlotValidator,
    ...planFields,
  }).index("by_user_slot", ["userId", "slot"]),
});
