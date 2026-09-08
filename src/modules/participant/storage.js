/**
 * Module 3 — participant session storage.
 *
 * Participants don't use Supabase Auth; their identity is a row id kept in
 * localStorage. The network-check verdict is kept in sessionStorage so the
 * check runs once per browser session rather than on every navigation.
 */

const STORAGE_KEY = 'kbh_participant';
const NETWORK_CHECK_KEY = 'kbh_network_checked';

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
    sessionStorage.removeItem(NETWORK_CHECK_KEY);
  } catch {
    /* ignore */
  }
}

/** Has this browser session already completed the post-login network check? */
export function hasCompletedNetworkCheck(participantId) {
  try {
    return sessionStorage.getItem(NETWORK_CHECK_KEY) === participantId;
  } catch {
    return false;
  }
}

export function markNetworkCheckComplete(participantId) {
  try {
    sessionStorage.setItem(NETWORK_CHECK_KEY, participantId);
  } catch {
    /* ignore */
  }
}

export function clearNetworkCheck() {
  try {
    sessionStorage.removeItem(NETWORK_CHECK_KEY);
  } catch {
    /* ignore */
  }
}
