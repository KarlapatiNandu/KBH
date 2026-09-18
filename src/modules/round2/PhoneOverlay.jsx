import TimerRing from './TimerRing';
import { CONTACT_KIND, lifelineLabel } from './lifelines';

/**
 * R10 — PhoneOverlay
 *
 * What Call an Expert and Phone a Friend put on the contestant's screen: the
 * question's own countdown freezes, this comes up over the board, and a
 * replacement countdown in the lifeline's cool palette runs in its place.
 *
 * The phone is the one from `assets and references/Phone-a-friend-UI.png` —
 * a glossy black handset with a "Contacts" header and a ruled list of names.
 * Both lifelines share it; only the address book behind it differs
 * (`lifeline_contacts.kind`), so Call an Expert dials the expert panel and
 * Phone a Friend the contestant's own list.
 *
 * The contact list is live: the host edits `lifeline_contacts` from the
 * console and the change lands here through the same realtime subscription
 * that carries the lifeline itself, phone already on screen.
 *
 * Props:
 *   lifelineKey  — 'call_expert' | 'phone_friend'
 *   contacts     — rows from lifeline_contacts, already filtered + ordered
 *   startedAtMs  — local anchor for the replacement countdown (see Round2Engine)
 *   durationMs   — how long the call gets
 *   onTimeUp     — the call's clock has run out. R13: that is the end of the
 *                  call, not a note to wait for the host — Round2Engine takes
 *                  this phone back down and restarts the question countdown,
 *                  so the board is on screen again the moment it is theirs.
 */
export default function PhoneOverlay({ lifelineKey, contacts, startedAtMs, durationMs, onTimeUp }) {
  const kind = CONTACT_KIND[lifelineKey];

  return (
    <div className="ph-overlay" role="dialog" aria-label={lifelineLabel(lifelineKey)}>
      <div className="ph-stage">
        <div className="ph-head">
          <span className="ph-eyebrow">Lifeline</span>
          <h3 className="ph-title">{lifelineLabel(lifelineKey)}</h3>
        </div>

        {/* The replacement clock, in the lifeline's own colours (R10) */}
        <div className="ph-timer">
          <TimerRing
            startedAtMs={startedAtMs}
            durationMs={durationMs}
            palette="lifeline"
            onTimeUp={onTimeUp}
          />
        </div>

        {/* The handset */}
        <div className="ph-phone">
          <div className="ph-screen">
            <h4 className="ph-screen-title">Contacts</h4>

            <ul className="ph-list">
              {contacts.length === 0 ? (
                <li className="ph-row ph-row--empty">
                  No {kind === 'expert' ? 'experts' : 'friends'} on the list yet
                </li>
              ) : (
                contacts.map((contact) => (
                  <li className="ph-row" key={contact.id}>
                    <span className="ph-avatar">
                      {contact.avatar_url ? (
                        <img src={contact.avatar_url} alt="" />
                      ) : (
                        // No photo: the first letter of the name, which is
                        // what the host will usually have time to enter.
                        <span className="ph-initial">
                          {(contact.name || '?').trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="ph-names">
                      <span className="ph-name">{contact.name}</span>
                      {contact.detail && <span className="ph-detail">{contact.detail}</span>}
                    </span>
                  </li>
                ))
              )}
            </ul>

            {/* Ruled empty space below the last name, as on the reference */}
            <span className="ph-fill" aria-hidden="true" />

            {/* Gloss: the diagonal sheen across the handset in the reference */}
            <span className="ph-gloss" aria-hidden="true" />
          </div>
        </div>

        <p className="ph-status">
          The question clock is paused while the call is live
        </p>
      </div>

      <style>{`
        .ph-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-lg) var(--space-md);
          background: rgba(3, 7, 26, 0.86);
          backdrop-filter: blur(6px);
          overflow-y: auto;
          animation: phFade 0.25s ease;
        }

        @keyframes phFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .ph-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-sm);
          margin: auto;
        }

        .ph-head { text-align: center; }

        .ph-eyebrow {
          display: block;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #7FD4EE;
        }

        .ph-title {
          font-family: 'Poppins', sans-serif;
          font-size: 22px;
          font-weight: 700;
          color: var(--cloud-white);
        }

        /* The dome docks on the top of the handset the way it docks on the
           question bar. It has to paint above the phone to do that — left
           to the default order the phone's shell covers its lower half. */
        .ph-timer {
          position: relative;
          z-index: 3;
          width: 124px;
        }

        /* ── The handset ──────────────────────────────────────── */
        /* Brushed metal shell, then the black screen inside it. */
        .ph-phone {
          width: min(320px, 82vw);
          padding: 10px;
          border-radius: 34px;
          background: linear-gradient(145deg, #6f7784 0%, #2b3039 40%, #11141a 100%);
          box-shadow:
            0 24px 60px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.35);
          animation: phRise 0.35s ease;
        }

        @keyframes phRise {
          from { opacity: 0; transform: translateY(18px) scale(0.97); }
          to   { opacity: 1; transform: none; }
        }

        .ph-screen {
          position: relative;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 26px;
          background: #050505;
          border: 1px solid rgba(255,255,255,0.14);
          padding: var(--space-md) 0 0;
          min-height: 420px;
        }

        .ph-screen-title {
          font-family: 'Poppins', sans-serif;
          font-size: 30px;
          font-weight: 700;
          color: #fff;
          text-align: center;
          padding: var(--space-md) var(--space-md) var(--space-lg);
          border-bottom: 1px solid rgba(255,255,255,0.28);
        }

        .ph-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        /* The ruled rows of the reference handset — a line under every row,
           including the empty ones past the end of the list. */
        .ph-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 62px;
          padding: 8px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.28);
        }

        .ph-row--empty {
          justify-content: center;
          color: rgba(255,255,255,0.45);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
        }

        .ph-avatar {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(180deg, #3a4150 0%, #1b1f28 100%);
          border: 1px solid rgba(255,255,255,0.25);
        }

        .ph-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .ph-initial {
          font-family: 'Poppins', sans-serif;
          font-size: 17px;
          font-weight: 700;
          color: #7FD4EE;
        }

        .ph-names {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .ph-name {
          font-family: 'Poppins', sans-serif;
          font-size: 19px;
          font-weight: 700;
          color: #fff;
          line-height: 1.2;
          overflow-wrap: anywhere;
        }

        .ph-detail {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: rgba(255,255,255,0.55);
          overflow-wrap: anywhere;
        }

        /* The ruling runs to the bottom of the screen whether or not there
           are names left to put on it — that is what makes it read as a
           phone's contact list rather than a floating card. */
        .ph-fill {
          flex: 1;
          min-height: 62px;
          background: repeating-linear-gradient(
            180deg,
            transparent 0,
            transparent 61px,
            rgba(255,255,255,0.28) 61px,
            rgba(255,255,255,0.28) 62px
          );
        }

        .ph-gloss {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            116deg,
            rgba(255,255,255,0.22) 0%,
            rgba(255,255,255,0.10) 34%,
            rgba(255,255,255,0.02) 46%,
            rgba(255,255,255,0) 54%
          );
        }

        .ph-status {
          margin-top: var(--space-xs);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: #9FD9EC;
          text-align: center;
        }

        @media (prefers-reduced-motion: reduce) {
          .ph-overlay, .ph-phone { animation: none; }
        }

        @media (max-width: 480px) {
          .ph-screen { min-height: 340px; }
          .ph-screen-title { font-size: 24px; padding-bottom: var(--space-md); }
          .ph-name { font-size: 17px; }
          .ph-row { min-height: 54px; }
        }
      `}</style>
    </div>
  );
}
