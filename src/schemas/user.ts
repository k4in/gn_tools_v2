import * as z from "zod";

import { USER_KEY_LENGTH } from "@/lib/constants/user-key.ts";
import { isValidUserKey, normalizeUserKey } from "@/lib/utils/user-key.ts";

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Mindestens 3 Zeichen.").max(40, "Höchstens 40 Zeichen."),
});

export const loginSchema = z.object({
  key: z
    .string()
    .refine((value) => isValidUserKey(normalizeUserKey(value)), `Bitte einen gültigen ${USER_KEY_LENGTH}-stelligen Code eingeben.`),
});
