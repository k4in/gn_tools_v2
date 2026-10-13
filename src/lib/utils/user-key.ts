import { USER_KEY_ALPHABET, USER_KEY_LENGTH } from "@/lib/constants/user-key.ts";

/** Entfernt Trennzeichen und Leerzeichen und korrigiert leicht verwechselbare Zeichen (O → 0, I/L → 1). */
export function normalizeUserKey(input: string) {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function isValidUserKey(value: string) {
  return value.length === USER_KEY_LENGTH && [...value].every((char) => USER_KEY_ALPHABET.includes(char));
}

export function formatUserKey(key: string) {
  return key.match(/.{1,4}/g)?.join("-") ?? key;
}
