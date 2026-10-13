/** Crockford-Base32: ohne I, L, O und U, damit sich der Code gut abtippen lässt. */
export const USER_KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Zwei Viererblöcke, angezeigt als `XXXX-XXXX`. */
export const USER_KEY_LENGTH = 8;

export const USER_KEY_STORAGE_KEY = "gn_tools.user-key";

export const NEW_KEY_NOTICE_STORAGE_KEY = "gn_tools.show-new-key-notice";
