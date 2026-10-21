import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server.ts";
import { assertPlanEntries } from "./lib/planChecks.ts";
import { findUserByKey, hashUserKey, requireUserByKey } from "./lib/userKey.ts";
import { CURRENT_PLAN_VERSION, DEFAULT_PLAN_SETTINGS, planEntryValidator, planSlotValidator } from "./lib/validators.ts";

const USER_NAME_MIN_LENGTH = 3;
const USER_NAME_MAX_LENGTH = 40;
const PLAN_SLOTS = [1, 2, 3] as const;

function normalizeUserName(name: string) {
  const trimmed = name.trim();

  if (trimmed.length < USER_NAME_MIN_LENGTH || trimmed.length > USER_NAME_MAX_LENGTH) {
    throw new ConvexError(`Der Name muss zwischen ${USER_NAME_MIN_LENGTH} und ${USER_NAME_MAX_LENGTH} Zeichen lang sein.`);
  }

  return trimmed;
}

/** Der Nutzer zum Code, oder `null`, wenn der Code unbekannt ist. */
export const me = query({
  args: { key: v.string() },
  returns: v.union(
    v.object({
      name: v.string(),
      activeSlot: planSlotValidator,
      liveSlot: v.union(planSlotValidator, v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, { key }) => {
    const user = await findUserByKey(ctx, key);
    return user ? { name: user.name, activeSlot: user.activeSlot, liveSlot: user.liveSlot } : null;
  },
});

/** Legt den Nutzer mit drei Plan-Slots an, alle mit `entries` (der Standard-Vorlage des Clients). */
export const create = mutation({
  args: { key: v.string(), name: v.string(), entries: v.array(planEntryValidator) },
  returns: v.null(),
  handler: async (ctx, { key, name, entries }) => {
    if (await findUserByKey(ctx, key)) {
      throw new ConvexError("Dieser Code ist schon vergeben. Bitte erzeuge einen neuen.");
    }
    assertPlanEntries(entries);

    const userId = await ctx.db.insert("users", {
      keyHash: await hashUserKey(key),
      name: normalizeUserName(name),
      activeSlot: 1,
      liveSlot: null,
    });
    for (const slot of PLAN_SLOTS) {
      await ctx.db.insert("plans", {
        userId,
        slot,
        entries,
        planVersion: CURRENT_PLAN_VERSION,
        taxes: [],
        ignoreNonTechDeps: false,
        settings: DEFAULT_PLAN_SETTINGS,
      });
    }
    return null;
  },
});

export const setActiveSlot = mutation({
  args: { key: v.string(), slot: planSlotValidator },
  returns: v.null(),
  handler: async (ctx, { key, slot }) => {
    const user = await requireUserByKey(ctx, key);
    await ctx.db.patch(user._id, { activeSlot: slot });
    return null;
  },
});

export const setLiveSlot = mutation({
  args: { key: v.string(), slot: v.union(planSlotValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, { key, slot }) => {
    const user = await requireUserByKey(ctx, key);
    await ctx.db.patch(user._id, { liveSlot: slot });
    return null;
  },
});
