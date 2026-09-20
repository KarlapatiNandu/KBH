import { SOUNDS, SOUND_BY_ID } from './sounds';

/**
 * R17 — the audio engine. A module singleton over one preloaded
 * HTMLAudioElement per clip.
 *
 * A device only ever plays once it has been made a *speaker* — see
 * `enableSpeaker`. That is a click, which is what the browser's autoplay
 * rules want anyway, and it is what stops every participant with the Round 2
 * page open from sounding off when the host presses a button.
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

let speaker = false;
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

// ─── Speaker state ──────────────────────────────────────────

export function isSpeaker() {
  return speaker;
}

// For useSyncExternalStore.
export function subscribeSpeaker(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Make this device the one the room hears. Must run inside a click: playing
 * and immediately pausing every element there is what lets Safari (which
 * unlocks per element) and Chrome play them later without a gesture.
 */
export function enableSpeaker() {
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
  speaker = true;
  notify();
}

export function disableSpeaker() {
  stopAll({ fade: false });
  speaker = false;
  notify();
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
