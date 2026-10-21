import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server.ts";
import { assertPlanEntries, assertPlanSettings, assertTaxes } from "./lib/planChecks.ts";
import { requireUserByKey } from "./lib/userKey.ts";
import { planEntryValidator, planFields, planSettingsValidator, planSlotValidator, taxSegmentValidator } from "./lib/validators.ts";

/** Alle drei Plan-Slots des Nutzers, nach Slot sortiert. */
export const list = query({
  args: { key: v.string() },
  returns: v.array(v.object({ slot: planSlotValidator, ...planFields })),
  handler: async (ctx, { key }) => {
    const user = await requireUserByKey(ctx, key);
    const plans = await ctx.db
      .query("plans")
      .withIndex("by_user_slot", (q) => q.eq("userId", user._id))
      .collect();
    return plans.map(({ slot, entries, planVersion, taxes, ignoreNonTechDeps, settings }) => ({
      slot,
      entries,
      planVersion,
      taxes,
      ignoreNonTechDeps,
      settings,
    }));
  },
});

/** Überschreibt nur die übergebenen Felder eines Slots. */
export const update = mutation({
  args: {
    key: v.string(),
    slot: planSlotValidator,
    entries: v.optional(v.array(planEntryValidator)),
    planVersion: v.optional(v.number()),
    taxes: v.optional(v.array(taxSegmentValidator)),
    ignoreNonTechDeps: v.optional(v.boolean()),
    settings: v.optional(planSettingsValidator),
  },
  returns: v.null(),
  handler: async (ctx, { key, slot, entries, planVersion, taxes, ignoreNonTechDeps, settings }) => {
    const user = await requireUserByKey(ctx, key);
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_user_slot", (q) => q.eq("userId", user._id).eq("slot", slot))
      .unique();
    if (!plan) {
      throw new ConvexError("Plan nicht gefunden.");
    }

    if (entries) assertPlanEntries(entries);
    if (taxes) assertTaxes(taxes);
    if (settings) assertPlanSettings(settings);

    await ctx.db.patch(plan._id, {
      ...(entries ? { entries } : {}),
      ...(planVersion !== undefined ? { planVersion } : {}),
      ...(taxes ? { taxes } : {}),
      ...(ignoreNonTechDeps !== undefined ? { ignoreNonTechDeps } : {}),
      ...(settings ? { settings } : {}),
    });
    return null;
  },
});
