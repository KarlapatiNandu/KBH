import LifelineIcon from './LifelineIcon';
import { lifelineLabel } from './lifelines';

/** How each status reads out, on hover and to a screen reader. */
const STATUS_NOTE = {
  available: 'still available',
  picked: 'picked',
  active: 'live now',
  used: 'used',
};

/**
 * R10/R14 — one lifeline medallion.
 *
 * The gold-rimmed oval from `assets and references/Lifeline.png`, lifted
 * out of LifelineBar so the rail under the question and the small set at
 * the head of the prize ladder (R14, `assets and references/
 * Price_list_display.png`) are the same badge at two sizes. They are
 * telling the contestant the same thing in two places, and a pair of
 * badges that could disagree about what "used" looks like would be worse
 * than only having one of them.
 *
 * What each status looks like:
 *   available — gold, ready
 *   picked    — named by the contestant and marked by the host, lit and
 *               lifted but still, because nothing is running yet (R12)
 *   active    — lit and pulsing, the one currently on the board
 *   used      — greyed out with a stroke through it, spent for good
 *
 * Props:
 *   lifelineKey — which of the four
 *   status      — 'available' | 'picked' | 'active' | 'used'
 *   size        — 'md' (the rail) | 'sm' (the ladder head)
 */
export default function LifelineBadge({ lifelineKey, status = 'available', size = 'md' }) {
  const label = lifelineLabel(lifelineKey);
  const note = STATUS_NOTE[status] || status;

  return (
    <span
      className={`ll-badge ll-badge--${status} ll-badge--${size}`}
      title={`${label} — ${note}`}
      role="img"
      aria-label={`${label} — ${note}`}
    >
      <span className="ll-oval">
        <LifelineIcon lifelineKey={lifelineKey} />
        {status === 'used' && (
          <svg className="ll-strike" viewBox="0 0 64 40" aria-hidden="true">
            <path d="M8 34 56 6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </span>
  );
}

/**
 * The badge's own styles. Rendered once by whichever component is showing
 * badges — the rail, the ladder, or both at once — the same way
 * Round2Styles is rendered by every branch of Round2Engine.
 */
export function LifelineBadgeStyles() {
  return (
    <style>{`
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

      /* R14 — the small set, for the head of the prize ladder. Same
         medallion, sized to sit above a list rather than across a bar. */
      .ll-badge--sm .ll-oval {
        width: 54px;
        height: 34px;
        border-width: 2px;
      }

      .ll-badge--sm .ll-oval .ll-icon {
        width: 38px;
        height: 24px;
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
        .ll-oval {
          width: 58px;
          height: 38px;
        }

        .ll-oval .ll-icon {
          width: 40px;
          height: 26px;
        }

        .ll-badge--sm .ll-oval {
          width: 46px;
          height: 30px;
        }

        .ll-badge--sm .ll-oval .ll-icon {
          width: 32px;
          height: 20px;
        }
      }
    `}</style>
  );
}
