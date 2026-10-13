import * as z from "zod";

const envSchema = z.object({
  VITE_CONVEX_URL: z.url(),
});

export const env = envSchema.parse(import.meta.env);
