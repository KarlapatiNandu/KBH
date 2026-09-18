import LifelineBadge, { LifelineBadgeStyles } from './LifelineBadge';
import { LIFELINES } from './lifelines';

/**
 * R10 — LifelineBar
 *
 * The rail of lifelines that runs under the question bar: one wide hex
 * carrying four gold-rimmed oval badges, as in
 * `assets and references/Lifeline.png`.
 *
 * Display only — the contestant never taps these. The host plays a
 * lifeline from the admin console, exactly as they lock in the answer
 * (R7), and this bar mirrors the result. The badge itself, and what each
 * status looks like, lives in LifelineBadge — shared with the small set
 * at the head of the prize ladder (R14).
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
          {LIFELINES.map(({ key }) => (
            <LifelineBadge key={key} lifelineKey={key} status={statuses?.[key] || 'available'} />
          ))}
        </div>
      </div>

      <LifelineBadgeStyles />

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

        @media (max-width: 640px) {
          .r2-hex--lifelines .ll-bar {
            padding: 8px calc(var(--r2-hex-cut) + 6px);
            min-height: 58px;
            gap: var(--space-xs);
          }
        }
      `}</style>
    </div>
  );
}
