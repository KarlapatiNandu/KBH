import { useState, useEffect, useRef, useCallback } from 'react';
import { SOUNDS, SOUND_GROUPS, openSoundChannel } from '../sound';

/**
 * R17 — the host's soundboard.
 *
 * A dock down the right of the admin panel, so it stays under the host's hand
 * on Round Control instead of being one more tab to leave the show for. Every
 * press is broadcast on the `kbh-sfx` channel and played by whichever Round 2
 * screen has been made a speaker (SoundToggle) — nothing plays on this
 * machine. Every clip is here, KBC intro included; that one has no automatic
 * cue and is only ever played from this dock.
 *
 * The status line is Presence: it says whether a speaker is actually
 * listening, which is the thing that goes wrong on the day (a refreshed
 * contestant screen is silent until someone clicks Enable sound on it).
 */

const FLASH_MS = 700;

export default function SoundBoard({ onClose }) {
  const channelRef = useRef(null);
  const flashTimer = useRef(null);
  const [connected, setConnected] = useState(false);
  const [screens, setScreens] = useState([]);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    const channel = openSoundChannel({
      onPresence: setScreens,
      onStatus: (status) => setConnected(status === 'SUBSCRIBED'),
    });
    channelRef.current = channel;

    return () => {
      clearTimeout(flashTimer.current);
      channelRef.current = null;
      channel.close();
    };
  }, []);

  const send = useCallback((cmd, key) => {
    channelRef.current?.send(cmd);
    setFlash(key);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const speakers = screens.filter((s) => s.speaker).length;

  let status;
  if (!connected) {
    status = { tone: 'off', text: 'Connecting…' };
  } else if (speakers > 0) {
    status = { tone: 'ok', text: speakers === 1 ? 'Speaker ready' : `${speakers} speakers ready` };
  } else if (screens.length > 0) {
    status = { tone: 'warn', text: 'Round 2 screen is muted — click Enable sound on it' };
  } else {
    status = { tone: 'off', text: 'No Round 2 screen connected' };
  }

  return (
    <div className="sb">
      <div className="sb-head">
        <h2 className="sb-title">🔊 Sound Board</h2>
        <button type="button" className="btn-icon sb-close" title="Close soundboard" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={`sb-status sb-status--${status.tone}`}>
        <span className="sb-dot" />
        {status.text}
      </div>

      <button
        type="button"
        className={`btn btn-secondary btn-sm sb-stop ${flash === 'stop' ? 'sb-btn--sent' : ''}`}
        onClick={() => send({ type: 'stop' }, 'stop')}
      >
        ■ Stop all
      </button>

      {SOUND_GROUPS.map((group) => (
        <section key={group} className="sb-group">
          <h3 className="sb-group-title">{group}</h3>
          {SOUNDS.filter((s) => s.group === group).map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sb-btn ${flash === s.id ? 'sb-btn--sent' : ''}`}
              onClick={() => send({ type: 'play', id: s.id }, s.id)}
            >
              <span className="sb-btn-label">▶ {s.label}</span>
              <span className="sb-btn-time">{s.seconds}s</span>
            </button>
          ))}
        </section>
      ))}

      <p className="sb-note">
        Plays on the contestant&rsquo;s screen, over whatever is running. The
        show&rsquo;s own cues take over again at the next lock-in or serve.
      </p>

      <style>{`
        .sb {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
          padding: var(--space-lg) var(--space-md);
        }

        .sb-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .sb-title {
          font-size: 16px;
          font-weight: 700;
        }

        .sb-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          background: rgba(240, 244, 248, 0.06);
          color: rgba(240, 244, 248, 0.65);
        }

        .sb-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          flex-shrink: 0;
        }

        .sb-status--ok {
          background: rgba(46, 204, 113, 0.12);
          color: #4ade80;
        }

        .sb-status--warn {
          background: var(--warning-amber-soft);
          color: var(--warning-amber);
        }

        .sb-stop {
          width: 100%;
        }

        .sb-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .sb-group-title {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--pale-gold);
        }

        .sb-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 12px;
          border: 1px solid rgba(242, 183, 5, 0.18);
          border-radius: var(--radius-sm);
          background: rgba(242, 183, 5, 0.05);
          color: var(--cloud-white);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .sb-btn:hover {
          background: rgba(242, 183, 5, 0.12);
          border-color: rgba(242, 183, 5, 0.4);
        }

        .sb-btn--sent {
          background: rgba(242, 183, 5, 0.28);
          border-color: var(--spotlight-gold);
        }

        .sb-btn-time {
          font-size: 11px;
          color: var(--pale-gold);
          flex-shrink: 0;
        }

        .sb-note {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          line-height: 1.5;
          color: rgba(240, 244, 248, 0.5);
        }
      `}</style>
    </div>
  );
}
