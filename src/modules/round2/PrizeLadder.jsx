import { useEffect, useRef } from 'react';
import LifelineBadge, { LifelineBadgeStyles } from './LifelineBadge';
import { LIFELINES } from './lifelines';

/**
 * R14 — PrizeLadder
 *
 * The money tree, as the contestant opens it: the rungs of the run with
 * the cheapest at the bottom and the climb reading upwards, the small set
 * of lifelines above them, exactly as in
 * `assets and references/Price_list_display.png`.
 *
 * It is a panel the contestant opens and closes, not something that lives
 * on the board — the board is already carrying the question, the options,
 * the rail and the prize for the rung they are standing on, and the whole
 * ladder next to all of that is noise for fifteen of the sixteen seconds
 * they have. So it slides in over the board, and goes again.
 *
 * Three things are marked, and nothing else:
 *   now       — the rung being played. Gold and lit, as on the show.
 *   won       — the rungs already climbed, in gold text.
 *   milestone — the guaranteed floor, in white (`is_milestone`).
 *
 * The lifelines at the head are the same medallions as the rail under the
 * question (LifelineBadge), at the smaller size, and they carry the same
 * four statuses — so a contestant looking at the ladder to decide whether
 * to walk can see in the same glance what they still have left to spend.
 *
 * Props:
 *   rungs      — prize_ladder rows for the round, any order
 *   currentLevel — the rung being played (1-based), or null
 *   lifelineStatuses — { [key]: status }, or null to leave the head off
 *   onClose    — take the panel back off the board
 */
export default function PrizeLadder({ rungs, currentLevel = null, lifelineStatuses = null, onClose }) {
  const panelRef = useRef(null);

  // Escape closes it, the same way it closes any panel over a screen —
  // the contestant is holding a buzzer, not reading a manual.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Open on the rung they are standing on. The ladder is taller than the
  // panel once a run has more than a dozen rungs, and the one row that
  // must never need scrolling to is the current one.
  useEffect(() => {
    const el = panelRef.current?.querySelector('.pl-row--now');
    el?.scrollIntoView({ block: 'center' });
  }, [currentLevel, rungs]);

  // Top of the ladder first: the climb reads upwards, so the list reads
  // downwards. (Price_list_display.png)
  const ordered = [...(rungs || [])].sort((a, b) => b.level - a.level);

  // What is left to spend. A lifeline that is picked or running is still
  // theirs — it is only `used` that has gone.
  const remaining = lifelineStatuses
    ? LIFELINES.filter(({ key }) => (lifelineStatuses[key] || 'available') !== 'used').length
    : 0;

  return (
    <div className="pl-overlay" role="dialog" aria-label="Prize ladder" onClick={onClose}>
      {/* The panel swallows the click so only the backdrop closes it. */}
      <div className="pl-panel" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="pl-head">
          <div className="pl-titles">
            <span className="pl-eyebrow">Prize ladder</span>
            <h3 className="pl-title">Where you stand</h3>
          </div>
          <button className="pl-close" onClick={onClose} aria-label="Close the prize ladder">
            ✕
          </button>
        </div>

        {/* The lifelines still in hand, above the money — as on the show,
            and the reason to open the ladder at all is usually to weigh
            one against the other. */}
        {lifelineStatuses && (
          <div className="pl-lifelines">
            <div className="pl-lifeline-row">
              {LIFELINES.map(({ key }) => (
                <LifelineBadge
                  key={key}
                  lifelineKey={key}
                  status={lifelineStatuses[key] || 'available'}
                  size="sm"
                />
              ))}
            </div>
            {/* A struck-through badge is only obvious once you know that is
                what it means, and this panel is the one place the
                contestant is counting what they have left. */}
            <p className="pl-lifeline-note">
              {remaining === 0
                ? 'All four lifelines are spent.'
                : `${remaining} lifeline${remaining === 1 ? '' : 's'} left — the struck-through ones are gone.`}
            </p>
          </div>
        )}

        <ol className="pl-list">
          {ordered.length === 0 && (
            <li className="pl-empty">The host has not set a prize ladder yet.</li>
          )}

          {ordered.map((rung) => {
            const now = currentLevel !== null && rung.level === currentLevel;
            const won = currentLevel !== null && rung.level < currentLevel;
            return (
              <li
                className={`pl-row ${now ? 'pl-row--now' : ''} ${won ? 'pl-row--won' : ''} ${
                  rung.is_milestone ? 'pl-row--milestone' : ''
                }`}
                key={rung.id ?? rung.level}
                aria-current={now ? 'step' : undefined}
              >
                <span className="pl-level">{rung.level}</span>
                <span className="pl-label">{rung.label}</span>
                {rung.is_milestone && (
                  <span className="pl-guaranteed" title="Guaranteed — you cannot fall below this">
                    ✦
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <p className="pl-foot">
          <span className="pl-key pl-key--milestone">✦</span> guaranteed rung — you keep this
          much once you pass it
        </p>
      </div>

      <LifelineBadgeStyles />

      <style>{`
        .pl-overlay {
          position: fixed;
          inset: 0;
          z-index: 180;
          display: flex;
          justify-content: flex-end;
          background: rgba(3, 7, 26, 0.72);
          backdrop-filter: blur(4px);
          animation: plFade 0.2s ease;
        }

        @keyframes plFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* The ladder comes in from the side rather than the middle: the
           board stays visible behind it, which is what makes closing it
           again feel like putting something down rather than leaving a
           screen. */
        .pl-panel {
          position: relative;
          display: flex;
          flex-direction: column;
          width: min(420px, 100%);
          height: 100%;
          padding: var(--space-md) var(--space-md) var(--space-sm);
          background:
            radial-gradient(ellipse 600px 420px at 120% 30%, rgba(242,183,5,0.16) 0%, transparent 60%),
            linear-gradient(180deg, #101c55 0%, #0a1138 60%, #060c2a 100%);
          background-color: #0a1138;
          border-left: 2px solid var(--antique-gold);
          box-shadow: -20px 0 60px rgba(0,0,0,0.6);
          animation: plSlide 0.28s cubic-bezier(0.22, 1, 0.36, 1);
        }

        @keyframes plSlide {
          from { transform: translateX(24px); opacity: 0; }
          to   { transform: none; opacity: 1; }
        }

        .pl-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-sm);
          padding-bottom: var(--space-sm);
        }

        .pl-eyebrow {
          display: block;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--pale-gold);
        }

        .pl-title {
          font-family: 'Poppins', sans-serif;
          font-size: 20px;
          font-weight: 700;
          color: var(--cloud-white);
        }

        .pl-close {
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(242,183,5,0.35);
          background: rgba(4,10,36,0.6);
          color: var(--pale-gold);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
        }

        .pl-close:hover {
          border-color: var(--spotlight-gold);
          color: var(--spotlight-gold);
        }

        /* ── The lifelines still in hand ──────────────────────── */
        .pl-lifelines {
          padding: var(--space-sm) 0 var(--space-md);
          border-bottom: 1px solid rgba(242,183,5,0.18);
        }

        .pl-lifeline-row {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: var(--space-sm);
        }

        .pl-lifeline-note {
          margin-top: var(--space-sm);
          text-align: center;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: var(--pale-gold);
        }

        /* ── The rungs ────────────────────────────────────────── */
        .pl-list {
          flex: 1;
          overflow-y: auto;
          list-style: none;
          margin: 0;
          padding: var(--space-sm) 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .pl-empty {
          padding: var(--space-lg) var(--space-sm);
          text-align: center;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--pale-gold);
        }

        .pl-row {
          display: grid;
          grid-template-columns: 38px 1fr 18px;
          align-items: center;
          gap: var(--space-sm);
          padding: 5px 10px;
          border-radius: var(--radius-pill);
          border: 1px solid transparent;
          font-family: 'Poppins', sans-serif;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: var(--antique-gold);
          transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
        }

        .pl-level {
          text-align: right;
          font-size: 16px;
          opacity: 0.85;
        }

        .pl-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Already climbed — full gold, the money that is behind them. */
        .pl-row--won {
          color: var(--spotlight-gold);
        }

        /* The guaranteed rungs are the white ones on the show: the two
           numbers on the whole ladder a contestant actually plans around.
           White reads as "this one is different" without competing with
           the lit current rung, which is the only gold-filled row. */
        .pl-row--milestone {
          color: var(--cloud-white);
          text-shadow: 0 0 12px rgba(245,241,230,0.35);
        }

        .pl-guaranteed {
          font-size: 12px;
          color: var(--champagne-gold);
          opacity: 0.8;
        }

        /* The rung being played. Filled, so it is found without reading —
           the contestant glances at this panel mid-question. */
        .pl-row--now {
          color: var(--deep-midnight);
          background: linear-gradient(90deg, var(--champagne-gold) 0%, var(--spotlight-gold) 55%, var(--amber-glow) 100%);
          border-color: var(--champagne-gold);
          box-shadow: 0 0 18px rgba(242,183,5,0.45);
          text-shadow: none;
        }

        .pl-row--now .pl-guaranteed { color: var(--deep-midnight); opacity: 0.7; }

        .pl-foot {
          padding: var(--space-sm) 4px 0;
          border-top: 1px solid rgba(242,183,5,0.18);
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          line-height: 1.5;
          color: var(--pale-gold);
        }

        .pl-key--milestone { color: var(--champagne-gold); }

        @media (max-width: 480px) {
          .pl-panel {
            width: 100%;
            border-left: 0;
          }

          .pl-row {
            font-size: 15px;
            grid-template-columns: 30px 1fr 16px;
          }
        }
      `}</style>
    </div>
  );
}
