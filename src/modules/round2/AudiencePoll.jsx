import LifelineIcon from './LifelineIcon';
import { votesToPercents } from './lifelines';

/**
 * R11 — AudiencePoll
 *
 * The result of the Audience Poll, drawn the way the show draws it
 * (`assets and references/Audience_pole_Display.png`): a gold-framed blue
 * panel of gold cylinders, the percentage over each one, A B C D on a gold
 * rail underneath, and the audience badge docked on the bottom edge.
 *
 * It appears only once the host has ended the poll — the tally is typed into
 * the console while the poll is live, and ending it is the publish. The panel
 * emerges out of the board rather than popping in: it fades up out of a blur
 * and the cylinders grow off the rail one after another, so the numbers land
 * in order rather than all at once.
 *
 * What comes in are raw vote counts, not percentages. The split is worked out
 * here so the host only ever has to correct the one option they miscounted,
 * and so a poll of 37 people still reads as a clean 100%.
 *
 * Placement is the card's top-right corner (`assets and references/
 * Audience_pole_Display.png` again) — absolute inside `.r2-qc-card`, which is
 * the positioned ancestor. Below 720px there is no corner to spare, so it
 * drops back into the flow above the question bar instead.
 *
 * Props:
 *   votes   — one raw count per option, in option order
 *   labels  — the option letters, defaulting to A–D
 */

const DEFAULT_LABELS = ['A', 'B', 'C', 'D'];

export default function AudiencePoll({ votes, labels = DEFAULT_LABELS }) {
  if (!Array.isArray(votes) || votes.length === 0) return null;

  const percents = votesToPercents(votes);

  return (
    <div
      className="ap-wrap"
      role="img"
      aria-label={`Audience poll result — ${percents
        .map((p, i) => `${labels[i] ?? i + 1} ${p} percent`)
        .join(', ')}`}
    >
      <div className="ap-panel">
        <div className="ap-plot">
          {percents.map((percent, index) => (
            <div className="ap-col" key={index}>
              <span
                className="ap-pct"
                style={{ animationDelay: `${0.45 + index * 0.12}s` }}
              >
                {percent}%
              </span>
              {/* The cylinder grows off the rail. Height is read straight off
                  the percentage — a 0–100 axis, so two charts in one game are
                  comparable at a glance — off the plot's height less the room
                  the label above it needs, with a floor of a few pixels so a
                  1% option is still a visible disc rather than nothing. */}
              <span
                className="ap-bar"
                style={{
                  '--ap-h': `max(7px, calc((100% - 26px) * ${percent} / 100))`,
                  animationDelay: `${index * 0.12}s`,
                }}
              />
            </div>
          ))}
        </div>

        {/* The gold rail the cylinders stand on, with the letters below it */}
        <div className="ap-rail" aria-hidden="true" />

        <div className="ap-labels" aria-hidden="true">
          {percents.map((_, index) => (
            <span className="ap-label" key={index}>
              {labels[index] ?? index + 1}
            </span>
          ))}
        </div>
      </div>

      {/* The audience badge, docked on the panel's bottom edge */}
      <span className="ap-badge" aria-hidden="true">
        <LifelineIcon lifelineKey="audience_poll" />
      </span>

      <style>{`
        /* ── Placement ────────────────────────────────────────── */
        /* Top-right of the question card, over the prize rather than
           beside it: the board has no spare column at this width, and the
           chart is only up until the next question is served. */
        .ap-wrap {
          position: absolute;
          top: 52px;
          right: var(--space-md);
          z-index: 6;
          width: clamp(186px, 20vw, 240px);
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
          animation: apEmerge 0.62s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* Emerging from the background, not sliding in over it: the panel
           resolves out of a blur as it comes up to full opacity. */
        @keyframes apEmerge {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.92);
            filter: blur(10px);
          }
          to {
            opacity: 1;
            transform: none;
            filter: blur(0);
          }
        }

        /* ── The panel ────────────────────────────────────────── */
        .ap-panel {
          position: relative;
          width: 100%;
          padding: 12px 14px 8px;
          border-radius: 18px;
          border: 3px solid transparent;
          background:
            radial-gradient(120% 90% at 50% 0%, #1b2a76 0%, #101c58 45%, #08103a 100%) padding-box,
            linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 45%, var(--antique-gold) 100%) border-box;
          box-shadow:
            0 18px 44px rgba(0, 0, 0, 0.55),
            0 0 26px rgba(242, 183, 5, 0.28);
        }

        /* ── Plot ─────────────────────────────────────────────── */
        .ap-plot {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
          align-items: end;
          gap: 6px;
          height: 150px;
        }

        .ap-col {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          height: 100%;
        }

        .ap-pct {
          margin-bottom: 5px;
          font-family: 'Poppins', sans-serif;
          font-size: clamp(11px, 1.1vw, 14px);
          font-weight: 700;
          line-height: 1;
          color: var(--cloud-white);
          white-space: nowrap;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);
          animation: apFadeUp 0.4s ease both;
        }

        @keyframes apFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }

        /* The cylinder: a horizontal gradient does the round-ness, and the
           ellipse on top is the lid you see looking slightly down on it. */
        .ap-bar {
          position: relative;
          width: min(70%, 28px);
          height: var(--ap-h);
          border-radius: 3px 3px 2px 2px;
          background: linear-gradient(
            90deg,
            #6d5115 0%,
            #a97f24 12%,
            #f3d977 34%,
            #fffbe6 46%,
            #f2b705 62%,
            #b8862a 84%,
            #6d5115 100%
          );
          box-shadow: 0 0 14px rgba(242, 183, 5, 0.4);
          animation: apGrow 0.75s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .ap-bar::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: -3px;
          height: 6px;
          border-radius: 50%;
          background: linear-gradient(90deg, #b8862a 0%, #fffbe6 42%, #f2c94c 70%, #a97f24 100%);
        }

        @keyframes apGrow {
          from { height: 0; }
          to   { height: var(--ap-h); }
        }

        /* ── Rail + letters ───────────────────────────────────── */
        .ap-rail {
          height: 2px;
          margin: 0 -4px 5px;
          background: linear-gradient(
            90deg,
            var(--antique-gold),
            var(--champagne-gold) 50%,
            var(--antique-gold)
          );
          box-shadow: 0 0 6px rgba(242, 183, 5, 0.45);
        }

        .ap-labels {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
          gap: 6px;
          padding-bottom: 12px;
        }

        .ap-label {
          font-family: 'Poppins', sans-serif;
          font-size: clamp(16px, 1.7vw, 22px);
          font-weight: 700;
          line-height: 1;
          text-align: center;
          color: var(--cloud-white);
          text-shadow: 0 2px 3px rgba(0, 0, 0, 0.75);
        }

        /* ── Audience badge ───────────────────────────────────── */
        /* Docked on the bottom border, half in and half out, the way the
           show hangs it off the panel. */
        .ap-badge {
          position: relative;
          margin-top: -19px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 76px;
          height: 38px;
          border-radius: 50%;
          border: 2.5px solid transparent;
          background:
            linear-gradient(180deg, #14205c 0%, #0a1138 100%) padding-box,
            linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 45%, var(--antique-gold) 100%) border-box;
          color: var(--spotlight-gold);
          filter: drop-shadow(0 0 12px rgba(242, 183, 5, 0.5));
        }

        .ap-badge .ll-icon {
          width: 50px;
          height: 30px;
        }

        @media (prefers-reduced-motion: reduce) {
          .ap-wrap, .ap-bar, .ap-pct { animation: none; }
        }

        /* ── Narrow screens ───────────────────────────────────── */
        /* No corner to spare: the chart takes its own place in the flow,
           above the question bar, at a size that can actually be read. */
        @media (max-width: 720px) {
          .ap-wrap {
            position: static;
            width: min(260px, 78vw);
            margin: 0 auto var(--space-md);
          }
        }
      `}</style>
    </div>
  );
}
