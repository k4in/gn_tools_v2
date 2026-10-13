import { ConvexError } from "convex/values";

import { type QueryCtx } from "../_generated/server.ts";

/** 8 Zeichen Crockford-Base32 (ohne I, L, O, U), so wie sie der Client erzeugt. */
const USER_KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export async function hashUserKey(key: string) {
  if (!USER_KEY_PATTERN.test(key)) {
    throw new ConvexError("Ungültiges Code-Format.");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function findUserByKey(ctx: QueryCtx, key: string) {
  const keyHash = await hashUserKey(key);
  return await ctx.db
    .query("users")
    .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
    .unique();
}

export async function requireUserByKey(ctx: QueryCtx, key: string) {
  const user = await findUserByKey(ctx, key);

  if (!user) {
    throw new ConvexError("Unbekannter Code.");
  }

  return user;
}
