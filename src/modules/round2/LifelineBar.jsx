import LifelineIcon from './LifelineIcon';
import { LIFELINES } from './lifelines';

/** How each status reads out, on hover and to a screen reader. */
const STATUS_NOTE = {
  picked: 'picked',
  active: 'live now',
  used: 'used',
};

/**
 * R10 — LifelineBar
 *
 * The rail of lifelines that runs under the question bar: one wide hex
 * carrying four gold-rimmed oval badges, as in
 * `assets and references/Lifeline.png`.
 *
 * Display only — the contestant never taps these. The host plays a
 * lifeline from the admin console, exactly as they lock in the answer
 * (R7), and this bar mirrors the result:
 *
 *   available — gold, ready
 *   picked    — named by the contestant and marked by the host, ringed and
 *               lifted but still, because nothing is running yet (R12)
 *   active    — lit and pulsing, the one currently on the board
 *   used      — greyed out with a stroke through it, spent for good
 *
 * It borrows `.r2-hex` / `.r2-rail` from QuestionCard, inside which it is
 * always rendered, so the rail and the hexagon geometry line up with the
 * question and option bars above and below it.
 *
 * Props:
 *   statuses — { [key]: 'available' | 'picked' | 'active' | 'used' }
 */
export default function LifelineBar({ statuses }) {
  return (
    <div className="r2-rail r2-rail--lifelines">
      <div className="r2-hex r2-hex--lifelines">
        <div className="r2-hex-inner ll-bar">
          {LIFELINES.map(({ key, label }) => {
            const status = statuses?.[key] || 'available';
            return (
              <span
                key={key}
                className={`ll-badge ll-badge--${status}`}
                title={`${label}${STATUS_NOTE[status] ? ` — ${STATUS_NOTE[status]}` : ''}`}
                role="img"
                aria-label={`${label} — ${STATUS_NOTE[status] || status}`}
              >
                <span className="ll-oval">
                  <LifelineIcon lifelineKey={key} />
                  {status === 'used' && (
                    <svg className="ll-strike" viewBox="0 0 64 40" aria-hidden="true">
                      <path d="M8 34 56 6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <style>{`
        .r2-rail--lifelines {
          grid-template-columns: 1fr;
          margin-bottom: var(--space-lg);
        }

        .r2-hex--lifelines .ll-bar {
          padding: 10px calc(var(--r2-hex-cut) + 16px);
          min-height: 72px;
          gap: var(--space-md);
          justify-content: space-around;
        }

        .ll-badge {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s ease;
        }

        /* The oval bezel: a gold rim with the same midnight face as the
           hexes, so the badges read as part of the bar, not stuck on it. */
        .ll-oval {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 82px;
          height: 50px;
          border-radius: 50%;
          border: 2.5px solid transparent;
          background:
            linear-gradient(180deg, #14205c 0%, #0a1138 100%) padding-box,
            linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 45%, var(--antique-gold) 100%) border-box;
          color: var(--spotlight-gold);
          transition: color 0.25s ease, filter 0.25s ease, opacity 0.25s ease,
            box-shadow 0.25s ease, background 0.25s ease;
        }

        .ll-oval .ll-icon {
          width: 56px;
          height: 34px;
        }

        /* Picked (R12) and live — the same lit medallion, because from the
           contestant's seat they are the same announcement: this is the
           lifeline. The oval fills with gold, the figures go midnight
           against it and a halo spills out past the rim, as in the
           Lifeline.png reference. Only the pulse separates them: a pick is
           still, a lifeline actually running breathes. */
        .ll-badge--picked,
        .ll-badge--active {
          /* The rail is clipped to the hexagon, so the badge grows in place
             rather than lifting off it — a halo that spilled past the top
             edge would be sheared off. */
          transform: scale(1.06);
        }

        .ll-badge--picked .ll-oval,
        .ll-badge--active .ll-oval {
          color: var(--deep-midnight);
          background:
            linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 55%, var(--amber-glow) 100%) padding-box,
            linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 45%, var(--antique-gold) 100%) border-box;
          box-shadow:
            0 0 0 4px rgba(242,183,5,0.18),
            0 0 18px 6px rgba(242,183,5,0.5);
        }

        /* Live now — the badge the host has just played. */
        .ll-badge--active .ll-oval {
          animation: llPulse 1.6s ease-in-out infinite;
        }

        @keyframes llPulse {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(242,183,5,0.45)); }
          50%      { filter: drop-shadow(0 0 16px rgba(242,183,5,0.9)); }
        }

        /* Spent. Dimmed rather than removed — knowing what is gone is half
           of what the bar is for. */
        .ll-badge--used .ll-oval {
          color: rgba(242,183,5,0.3);
          opacity: 0.55;
          filter: grayscale(0.4);
        }

        .ll-strike {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          color: var(--danger-red);
          opacity: 0.85;
        }

        @media (prefers-reduced-motion: reduce) {
          .ll-badge--active .ll-oval { animation: none; }
        }

        @media (max-width: 640px) {
          .r2-hex--lifelines .ll-bar {
            padding: 8px calc(var(--r2-hex-cut) + 6px);
            min-height: 58px;
            gap: var(--space-xs);
          }

          .ll-oval {
            width: 58px;
            height: 38px;
          }

          .ll-oval .ll-icon {
            width: 40px;
            height: 26px;
          }
        }
      `}</style>
    </div>
  );
}
