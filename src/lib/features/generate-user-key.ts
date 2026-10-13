import { USER_KEY_ALPHABET, USER_KEY_LENGTH } from "@/lib/constants/user-key.ts";

export function generateUserKey() {
  // 256 ist durch 32 teilbar, die Zeichen sind also gleichverteilt.
  const bytes = crypto.getRandomValues(new Uint8Array(USER_KEY_LENGTH));
  return Array.from(bytes, (byte) => USER_KEY_ALPHABET[byte % USER_KEY_ALPHABET.length]).join("");
}
