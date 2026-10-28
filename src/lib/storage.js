// One safe place for localStorage.
// localStorage can throw (private mode, storage full, blocked by the browser),
// so every call is wrapped. If storage fails, the app keeps working and just
// doesn't remember things.

// ----- Plain text values (like "available") -----
export function getText(key, fallback = null) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value
  } catch {
    return fallback
  }
}

export function setText(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the value just won't persist */
  }
}

// ----- Objects and arrays (stored as JSON) -----
export function getJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) ?? fallback
  } catch {
    return fallback
  }
}

export function setJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: the value just won't persist */
  }
}
