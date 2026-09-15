/**
 * Admin session storage.
 *
 * Admins don't use Supabase Auth; their identity is a row id kept in
 * localStorage, same pattern as the participant session in
 * ../participant/storage.js.
 */

const STORAGE_KEY = 'kbh_admin';

export function getStoredAdmin() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.admin_id ? parsed : null;
  } catch {
    return null;
  }
}

export function storeAdmin(admin) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
  } catch {
    // Private-mode browsers can throw here; the in-memory session still works.
  }
}

export function clearStoredAdmin() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
