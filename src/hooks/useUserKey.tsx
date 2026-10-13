import { useSyncExternalStore } from "react";

import { NEW_KEY_NOTICE_STORAGE_KEY, USER_KEY_STORAGE_KEY } from "@/lib/constants/user-key.ts";
import { isValidUserKey } from "@/lib/utils/user-key.ts";

const listeners = new Set<() => void>();

function readItem(storageKey: string) {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeItem(storageKey: string, value: string | null) {
  try {
    if (value) {
      localStorage.setItem(storageKey, value);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch (error) {
    console.error(`Could not write ${storageKey}`, error);
  }
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function readUserKey() {
  const value = readItem(USER_KEY_STORAGE_KEY);
  return value && isValidUserKey(value) ? value : null;
}

function readShowNewKeyNotice() {
  return readItem(NEW_KEY_NOTICE_STORAGE_KEY) === "true";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Login/Logout in einem anderen Tab übernehmen.
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Der Code ist Benutzer-ID und Passwort zugleich und liegt nur im localStorage. */
export function useUserKey() {
  const userKey = useSyncExternalStore(subscribe, readUserKey);
  const showNewKeyNotice = useSyncExternalStore(subscribe, readShowNewKeyNotice);

  /** `isNewKey` zeigt nach dem ersten Login einmalig den Dialog mit dem Code. */
  function saveUserKey(key: string, isNewKey = false) {
    writeItem(USER_KEY_STORAGE_KEY, key);
    writeItem(NEW_KEY_NOTICE_STORAGE_KEY, isNewKey ? "true" : null);
    notifyListeners();
  }

  function dismissNewKeyNotice() {
    writeItem(NEW_KEY_NOTICE_STORAGE_KEY, null);
    notifyListeners();
  }

  function clearUserKey() {
    writeItem(USER_KEY_STORAGE_KEY, null);
    writeItem(NEW_KEY_NOTICE_STORAGE_KEY, null);
    notifyListeners();
  }

  return { userKey, showNewKeyNotice, saveUserKey, dismissNewKeyNotice, clearUserKey };
}
