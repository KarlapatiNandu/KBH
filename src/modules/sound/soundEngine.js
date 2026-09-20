import { SOUNDS, SOUND_BY_ID } from './sounds';

/**
 * R17 — the audio engine. A module singleton over one preloaded
 * HTMLAudioElement per clip.
 *
 * There is no "enable sound" step. Browsers still refuse to play audio on a
 * page nobody has touched, so `armUnlock` waits (invisibly) for the first
 * click, key press or tap anywhere on the page and unlocks every clip then.
 * The login that leads to the Round 2 screen is already such a click, and in
 * that case the unlock happens the moment the screen mounts. Who is allowed to
 * make noise is not decided here — see useRound2Sound.
 *
 * HTMLAudioElement rather than WebAudio: the beds are 14–18 s MP3s, and the
 * small encoder-padding gap when one loops is inaudible under a suspense pad.
 */

const FADE_MS = 250;
const FADE_STEP_MS = 25;

const audios = new Map(); // id -> HTMLAudioElement
const fades = new Map(); // id -> interval id of a fade-out in flight

// Clips a hold froze mid-play, to be picked up again by `resumeAll`.
const paused = new Set();

// Has the page had the user gesture the browser wants before it will play?
let unlocked = typeof navigator !== 'undefined' && !!navigator.userActivation?.hasBeenActive;
let armed = false;
// The unlock pass runs once per page: a second one would "unlock" a clip a
// hold has paused mid-play, and reset its position.
let elementsUnlocked = false;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

function element(id) {
  let a = audios.get(id);
  if (!a) {
    const sound = SOUND_BY_ID[id];
    if (!sound) return null;
    a = new Audio(sound.url);
    a.preload = 'auto';
    audios.set(id, a);
  }
  return a;
}

function cancelFade(id, a) {
  const timer = fades.get(id);
  if (timer === undefined) return;
  clearInterval(timer);
  fades.delete(id);
  a.volume = 1;
}

function halt(a) {
  a.onended = null;
  a.pause();
  a.currentTime = 0;
  a.volume = 1;
}

// ─── Unlock state ───────────────────────────────────────────

export function isUnlocked() {
  return unlocked;
}

// For useSyncExternalStore.
export function subscribeUnlocked(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'];

/**
 * Get the clips ready and unlock them at the first opportunity. Loads every
 * clip now, so the first cue does not wait on a download, then unlocks on the
 * spot if the page has already had a gesture, or on the first one it gets.
 * Returns a disposer. Safe to call from several places; only the first arms.
 */
export function armUnlock() {
  SOUNDS.forEach(({ id }) => element(id));

  if (armed) return () => {};
  armed = true;

  if (unlocked) {
    unlockElements();
    return () => {};
  }

  const onGesture = () => {
    dispose();
    unlockElements();
    unlocked = true;
    notify();
  };
  const dispose = () => {
    GESTURES.forEach((type) => document.removeEventListener(type, onGesture, true));
    armed = false;
  };
  GESTURES.forEach((type) => document.addEventListener(type, onGesture, true));
  return dispose;
}

/**
 * Playing and immediately pausing every element inside a gesture is what
 * lets Safari (which unlocks per element) and Chrome play them later without
 * one.
 */
function unlockElements() {
  if (elementsUnlocked) return;
  elementsUnlocked = true;
  SOUNDS.forEach(({ id }) => {
    const a = element(id);
    if (!a || !a.paused) return;
    // `muted` doubles as the "still unlocking" mark: a real play() clears it,
    // and the unlock only pauses an element that is still muted, so it can
    // never cut a clip that started in the meantime.
    a.muted = true;
    a.play()
      .then(() => {
        if (a.muted) halt(a);
        a.muted = false;
      })
      .catch(() => {
        a.muted = false;
      });
  });
}

// ─── Playback ───────────────────────────────────────────────

export function play(id, { loop = false } = {}) {
  const a = element(id);
  if (!a) return;
  cancelFade(id, a);
  paused.delete(id);
  a.onended = null;
  a.muted = false;
  a.loop = loop;
  a.currentTime = 0;
  a.play().catch((err) => console.warn(`Sound "${id}" could not play:`, err.message));
}

/** `id`, then `nextId` — looping if asked — the moment `id` ends. */
export function playThen(id, nextId, { loopNext = false } = {}) {
  play(id);
  const a = element(id);
  if (a) a.onended = () => play(nextId, { loop: loopNext });
}

export function stop(id, { fade = true } = {}) {
  const a = audios.get(id);
  paused.delete(id);
  if (!a || a.paused) {
    if (a) halt(a);
    return;
  }
  // Drop the chain now: a clip fading out must not hand over to the next.
  a.onended = null;
  if (!fade) {
    cancelFade(id, a);
    halt(a);
    return;
  }
  if (fades.has(id)) return;

  const steps = FADE_MS / FADE_STEP_MS;
  let n = 0;
  const startVolume = a.volume;
  const timer = setInterval(() => {
    n += 1;
    a.volume = Math.max(0, startVolume * (1 - n / steps));
    if (n >= steps) {
      clearInterval(timer);
      fades.delete(id);
      halt(a);
    }
  }, FADE_STEP_MS);
  fades.set(id, timer);
}

export function stopAll({ fade = true } = {}) {
  paused.clear();
  audios.forEach((a, id) => stop(id, { fade }));
}

/** Manual plays: nothing else keeps playing under the clip the host asked for. */
export function playExclusive(id) {
  stopAll();
  play(id);
}

/**
 * Freeze whatever is playing, keeping its position — the sound's version of
 * the question clock being held. `resumeAll` picks it back up.
 */
export function pauseAll() {
  audios.forEach((a, id) => {
    if (a.paused || fades.has(id)) return;
    a.pause();
    paused.add(id);
  });
}

/** Returns false when there was nothing frozen to pick up. */
export function resumeAll() {
  if (paused.size === 0) return false;
  paused.forEach((id) => {
    const a = audios.get(id);
    if (a) a.play().catch(() => {});
  });
  paused.clear();
  return true;
}
