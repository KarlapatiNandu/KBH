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
 * HTMLAudioElement rather than WebAudio: the beds are 14–18 s MP3s, and one
 * element each is enough as long as nothing waits on the file's own end —
 * hence the music window below.
 *
 * R19 — nothing plays a whole file. Every clip declares where its sound
 * actually starts and ends (`music` in sounds.js), because these were cut
 * with up to a second of digital silence on the front and the back. A clip
 * starts at its music, a loop goes back there the moment it reaches the end
 * of the music, and a chained clip hands over at the same point. Left to the
 * element's own `loop` the bed dropped the room into a second of nothing
 * every fourteen seconds.
 */

const FADE_MS = 250;
const FADE_STEP_MS = 25;

// How often a playing clip's position is checked against its loop / handover
// point. Cheap, and well under the ~40 ms where a seam starts being heard.
const WATCH_MS = 20;

const audios = new Map(); // id -> HTMLAudioElement
const fades = new Map(); // id -> interval id of a fade-out in flight
// id -> callbacks waiting for that clip to finish on its own. (R20)
const endListeners = new Map();
// id -> interval watching that clip's playhead for the end of its music. A
// clip is either looping or handing over to the next, never both, so one
// watcher per clip is all there is.
const watchers = new Map();

// Has the page had the user gesture the browser wants before it will play?
let unlocked = false;
let armed = false;
// The unlock pass runs once per page: a second one would mute-play every clip
// again, and a cue landing inside that window would come out silent.
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

/** Where the sound is in the file: `[start, end]`, the whole file by default. */
function music(id) {
  return SOUND_BY_ID[id]?.music ?? [0, Infinity];
}

/**
 * The element may not have its metadata yet on the very first play of the
 * page, and a seek before that can throw. Worth nothing more than the clip
 * starting where it would have started anyway.
 */
function seek(a, seconds) {
  try {
    a.currentTime = seconds;
  } catch {
    /* not loaded yet */
  }
}

/** Call `onReach` once the clip's playhead passes `at`. */
function watch(id, a, at, onReach) {
  unwatch(id);
  if (!Number.isFinite(at)) return;
  watchers.set(
    id,
    setInterval(() => {
      if (!a.paused && a.currentTime >= at) onReach();
    }, WATCH_MS)
  );
}

function unwatch(id) {
  const timer = watchers.get(id);
  if (timer === undefined) return;
  clearInterval(timer);
  watchers.delete(id);
}

function halt(id, a) {
  unwatch(id);
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
 * Returns a disposer. Safe to call from several places, and again after an
 * unlock: only the first call that finds the page still locked arms.
 */
export function armUnlock() {
  SOUNDS.forEach(({ id }) => element(id));

  // Ask the browser rather than remembering: the tap that walked the
  // contestant from the round list to the hot seat is activation this page
  // already has, and it landed before anything here was listening for one.
  // Reading it at arm time is what lets the board's first cue play on the
  // screen it was opened on.
  if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive) unlock();

  if (unlocked || armed) return () => {};
  armed = true;

  const onGesture = () => {
    dispose();
    unlock();
  };
  const dispose = () => {
    GESTURES.forEach((type) => document.removeEventListener(type, onGesture, true));
    armed = false;
  };
  GESTURES.forEach((type) => document.addEventListener(type, onGesture, true));
  return dispose;
}

function unlock() {
  unlockElements();
  if (unlocked) return;
  unlocked = true;
  notify();
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
        if (a.muted) halt(id, a);
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
  const [from, to] = music(id);
  cancelFade(id, a);
  unwatch(id);
  a.onended = null;
  a.muted = false;
  // R19 — the loop is the watcher's, not the element's: `loop` restarts at
  // the file's end, which is a second of silence later and a second of
  // silence earlier than the music.
  a.loop = loop && !Number.isFinite(to);
  seek(a, from);
  a.play().catch((err) => console.warn(`Sound "${id}" could not play:`, err.message));

  if (!loop) {
    // R20 — a one-shot is over at the end of its music, not at the end of
    // the file: waiting out the silent tail would hold the end of a run
    // (Round2Engine) a second past the last note. The tail is left to play
    // under the silence rather than cut, exactly as a chained clip's is.
    // Nothing follows a one-shot — what comes after it is silence until the
    // next cue.
    const done = () => {
      unwatch(id);
      a.onended = null;
      ended(id);
    };
    a.onended = done;
    watch(id, a, to, done);
    return;
  }

  if (a.loop) return;

  watch(id, a, to, () => seek(a, from));
  // A tab the browser has throttled can have its watcher wake late enough
  // for the clip to run out. Pick the bed back up rather than leave the room
  // in silence until the next cue.
  a.onended = () => {
    seek(a, from);
    a.play().catch(() => {});
  };
}

/**
 * `id`, then `nextId` — looping if asked — the moment `id`'s music ends.
 * Not the moment the file ends: `question-sting` holds nearly a second of
 * silence after its last note, and the bed under the question is not going
 * to wait that out. The first clip is left to run its tail under the second;
 * nothing of it is cut.
 */
export function playThen(id, nextId, { loopNext = false } = {}) {
  play(id);
  const a = element(id);
  if (!a) return;
  const handover = () => {
    unwatch(id);
    a.onended = null;
    play(nextId, { loop: loopNext });
  };
  a.onended = handover;
  watch(id, a, music(id)[1], handover);
}

/**
 * R20 — call `fn` when `id` next finishes playing on its own. A clip that is
 * stopped, faded out or cut off by another cue has not finished, so nothing
 * fires for it: this is "the music ended", which is the beat the end of a
 * run waits on (Round2Engine). Returns a disposer.
 */
export function onEnded(id, fn) {
  let set = endListeners.get(id);
  if (!set) {
    set = new Set();
    endListeners.set(id, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) endListeners.delete(id);
  };
}

function ended(id) {
  const set = endListeners.get(id);
  if (!set) return;
  [...set].forEach((fn) => fn());
}

export function stop(id, { fade = true } = {}) {
  const a = audios.get(id);
  if (!a || a.paused) {
    if (a) halt(id, a);
    return;
  }
  // Drop the chain now: a clip fading out must not hand over to the next,
  // and a bed fading out must not loop back to the top.
  unwatch(id);
  a.onended = null;
  if (!fade) {
    cancelFade(id, a);
    halt(id, a);
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
      halt(id, a);
    }
  }, FADE_STEP_MS);
  fades.set(id, timer);
}

export function stopAll({ fade = true } = {}) {
  audios.forEach((a, id) => stop(id, { fade }));
}

/** Manual plays: nothing else keeps playing under the clip the host asked for. */
export function playExclusive(id) {
  stopAll();
  play(id);
}
