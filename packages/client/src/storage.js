// storage.js - localStorage can be missing or throw (private mode, blocked
// storage, sandboxed frames). Every helper here fails soft: a page without
// storage simply forgets its preferences between visits.

export function safeStorage() {
   try {
      return typeof window !== "undefined" ? window.localStorage : null;
   } catch {
      return null;
   }
}

/** Parse a stored JSON object merged over the fallback; the fallback alone on any failure. */
export function readJSON(storage, key, fallback) {
   try {
      const v = storage && storage.getItem(key);
      const parsed = v ? JSON.parse(v) : null;
      return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : { ...fallback };
   } catch {
      return { ...fallback };
   }
}

export function writeJSON(storage, key, value) {
   try {
      if (storage) storage.setItem(key, JSON.stringify(value));
   } catch {
      /* quota exceeded or private mode: forget it */
   }
}
