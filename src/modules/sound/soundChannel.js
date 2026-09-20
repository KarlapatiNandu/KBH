import { supabase } from '../../lib/supabase';

/**
 * R17 — how the host's soundboard reaches the room's speaker.
 *
 * One Supabase Realtime channel, no table and no migration: Broadcast carries
 * the host's button presses (ephemeral — a press with nobody listening is
 * simply gone, which is what a sound cue should be), and Presence carries
 * which screens are listening and whether any of them is a speaker, so the
 * soundboard can say so before the show finds out the hard way.
 */

const CHANNEL_NAME = 'kbh-sfx';
const COMMAND_EVENT = 'sfx';

/**
 * Open the channel.
 *
 *   onCommand(cmd)   — a broadcast arrived: { type: 'play', id } | { type: 'stop' }
 *   onPresence(list) — the set of connected screens changed: [{ speaker }]
 *   onStatus(status) — the channel's own state, e.g. 'SUBSCRIBED'
 *
 * Returns { send(cmd), track(meta), close() }. `track` announces this
 * screen's presence; the host's soundboard never calls it, so it counts only
 * the screens that can actually be heard.
 */
export function openSoundChannel({ onCommand, onPresence, onStatus } = {}) {
  const channel = supabase.channel(CHANNEL_NAME, {
    config: { broadcast: { self: false } },
  });

  let subscribed = false;
  let pendingMeta = null;

  if (onCommand) {
    channel.on('broadcast', { event: COMMAND_EVENT }, ({ payload }) => onCommand(payload));
  }

  if (onPresence) {
    channel.on('presence', { event: 'sync' }, () => {
      const screens = Object.values(channel.presenceState()).flat();
      onPresence(screens);
    });
  }

  channel.subscribe((status) => {
    subscribed = status === 'SUBSCRIBED';
    onStatus?.(status);
    // A track() made before the channel was up is held, not lost.
    if (subscribed && pendingMeta) channel.track(pendingMeta);
  });

  return {
    send(cmd) {
      return channel.send({ type: 'broadcast', event: COMMAND_EVENT, payload: cmd });
    },
    track(meta) {
      pendingMeta = meta;
      if (subscribed) channel.track(meta);
    },
    close() {
      supabase.removeChannel(channel);
    },
  };
}
