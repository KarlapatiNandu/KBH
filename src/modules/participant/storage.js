/**
 * Module 3 — participant session storage.
 *
 * Participants don't use Supabase Auth; their identity is a row id kept in
 * localStorage. The network check is deliberately *not* persisted — it runs on
 * every app load, so a connection that degrades mid-event still gets caught.
 */

const STORAGE_KEY = 'kbh_participant';

export function getStoredParticipant() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.participant_id ? parsed : null;
  } catch {
    return null;
  }
}

export function storeParticipant(participant) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(participant));
  } catch {
    // Private-mode browsers can throw here; the in-memory session still works.
  }
}

export function clearStoredParticipant() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
