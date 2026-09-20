import { useSyncExternalStore } from 'react';
import { isSpeaker, subscribeSpeaker, enableSpeaker, disableSpeaker } from './soundEngine';

/**
 * R17 — the "Enable sound" pill on the Round 2 screen.
 *
 * Clicking it makes this device the room's speaker. It has to be a click:
 * browsers refuse to play audio on a page nobody has touched, and the
 * click is also what unlocks every clip up front (see enableSpeaker). Sound
 * is off after every page load, so a refresh on the day means one more click.
 */
export default function SoundToggle() {
  const on = useSyncExternalStore(subscribeSpeaker, isSpeaker);

  return (
    <button
      type="button"
      className={`btn btn-sm ${on ? 'btn-secondary' : 'btn-primary'}`}
      onClick={on ? disableSpeaker : enableSpeaker}
      title={on ? 'This screen is playing the show sounds — click to mute' : 'Click to let this screen play the show sounds'}
      aria-pressed={on}
    >
      {on ? '🔊 Sound on' : '🔇 Enable sound'}
    </button>
  );
}
