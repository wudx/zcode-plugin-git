// persisted prefs (localStorage may be unavailable — degrade to session-only)

export function lsGet(k) {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function lsSet(k, v) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* session-only */
  }
}
