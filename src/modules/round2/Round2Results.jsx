import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import PriceTag from './PriceTag';
import { clearedLevels, checkpointReached } from './checkpoints';

/**
 * Module 5 — Round2Results
 *
 * Shown after Round 2 completes for the Hot Seat participant.
 * Displays:
 *   - What they take home
 *   - Total score
 *   - Per-question breakdown (correct/wrong, points, response time)
 *
 * R15 — the money leads. Points are the tournament's bookkeeping; the
 * number a contestant walks off with is the last guaranteed checkpoint they
 * passed on the ladder, and on a wrong answer that is the whole reason this
 * screen came up. Passing no checkpoint at all is still a result — ₹0, the
 * floor everybody starts on — so it is shown as a figure rather than left
 * blank.
 *
 * Props:
 *   ladder     — prize_ladder rows, so the checkpoint can be read without a
 *                second trip; fetched here when the caller has none
 *   eliminated — they were knocked out rather than reaching the end of the
 *                run, which is all that changes the wording
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function Round2Results({ participant, questions, ladder = null, eliminated = false, onBack }) {
  const [myResponses, setMyResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTotal, setMyTotal] = useState(0);
  const [rungs, setRungs] = useState(ladder || []);

  useEffect(() => {
    fetchResults();
  }, []);

  const fetchResults = async () => {
    setLoading(true);

    const { data: responses } = await supabase
      .from('responses')
      .select('*')
      .eq('participant_id', participant.participant_id)
      .eq('round', 2)
      .order('created_at');

    if (responses) {
      setMyResponses(responses);
      const totalPoints = responses.reduce((sum, r) => sum + r.points_awarded, 0);
      setMyTotal(totalPoints);
    }

    // The caller usually has the ladder already (Round2Engine keeps it live
    // for the panel). Read it only when it does not — and say nothing on a
    // database without migration_v10: the checkpoint then falls back to the
    // zero floor, which is the honest answer when there is no ladder.
    if (!ladder || ladder.length === 0) {
      const { data: ladderRows } = await supabase
        .from('prize_ladder')
        .select('*')
        .eq('round', 2)
        .order('level');

      if (ladderRows) setRungs(ladderRows);
    }

    setLoading(false);
  };

  // The rungs they actually cleared, and the checkpoint that pays out.
  const cleared = clearedLevels(questions, myResponses);
  const checkpoint = checkpointReached(rungs, cleared);
  const wonNothing = checkpoint.level === 0;

  if (loading) {
    return (
      <div className="r2r-loading">
        <span className="r2r-spinner" />
        <p>Calculating your Hot Seat results…</p>
      </div>
    );
  }

  return (
    <div className="r2r">
      {/* What they take home. The tag first, because it is the only
          number on this screen the contestant came here for. (R15) */}
      <div className={`r2r-won ${wonNothing ? 'r2r-won--zero' : ''}`}>
        <span className="r2r-won-eyebrow">
          {eliminated ? 'Your run ends here — you take home' : 'You take home'}
        </span>
        <div className="r2r-won-tag">
          <PriceTag label={checkpoint.label} tone={wonNothing ? 'red' : 'gold'} size="lg" />
        </div>
        <p className="r2r-won-note">
          {wonNothing
            ? 'No checkpoint passed — the run pays the floor everybody starts on.'
            : `Checkpoint at stage ${checkpoint.level} — the last guaranteed rung you passed.`}
        </p>
      </div>

      {/* Hero Section */}
      <div className="r2r-hero">
        <div className="r2r-hero-badge">{eliminated ? '🎬' : '🔥'}</div>
        <h2 className="r2r-hero-title">{eliminated ? 'Out of the Hot Seat' : 'Hot Seat Complete!'}</h2>
        <p className="r2r-hero-tagline">
          {eliminated
            ? `You cleared ${cleared} stage${cleared === 1 ? '' : 's'} before the lights went out.`
            : getHotSeatQuip(myTotal, myResponses, questions.length)}
        </p>
        <div className="r2r-hero-stats">
          <div className="r2r-stat">
            <span className="r2r-stat-value">{myTotal}</span>
            <span className="r2r-stat-label">Total Points</span>
          </div>
          <div className="r2r-stat-divider" />
          <div className="r2r-stat">
            <span className="r2r-stat-value">
              {myResponses.filter((r) => r.is_correct).length}/{questions.length}
            </span>
            <span className="r2r-stat-label">Correct</span>
          </div>
        </div>
      </div>

      {/* Question Breakdown */}
      <div className="r2r-section">
        <h3 className="r2r-section-title">Your Answers</h3>
        <div className="r2r-breakdown">
          {questions.map((q, i) => {
            const resp = myResponses.find((r) => r.question_id === q.id);
            return (
              <div key={q.id} className="r2r-q-row">
                <div className="r2r-q-header">
                  <span className="r2r-q-num">{i + 1}</span>
                  <span className="r2r-q-text">{q.text}</span>
                  {resp ? (
                    <span className={`badge ${resp.is_correct ? 'badge--correct' : 'badge--wrong'}`}>
                      {resp.is_correct ? '✓ Correct' : '✗ Wrong'}
                    </span>
                  ) : (
                    <span className="badge badge--pending">No Answer</span>
                  )}
                </div>
                {resp && (
                  <div className="r2r-q-detail">
                    <span>Your answer: <strong>{OPTION_LABELS[resp.selected_option]}</strong></span>
                    {!resp.is_correct && (
                      <span>Correct: <strong>{OPTION_LABELS[q.correct_option]}</strong></span>
                    )}
                    <span>+{resp.points_awarded} pts</span>
                    <span>{(resp.response_time_ms / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Back button */}
      <div className="r2r-footer">
        <button className="btn btn-primary" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      <style>{`
        .r2r {
          max-width: 700px;
          margin: 0 auto;
          padding: var(--space-xl) var(--space-md);
        }

        .r2r-loading {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--warning-amber);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-md);
        }

        .r2r-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid transparent;
          border-top-color: var(--warning-amber);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        /* ── What they take home (R15) ─────────────────────── */
        /* Its own block above the hero rather than a stat inside it: the
           points are how the tournament scores them, and this is the
           number they will repeat to everyone tonight. */
        .r2r-won {
          text-align: center;
          padding: var(--space-xl) var(--space-lg) var(--space-lg);
          margin-bottom: var(--space-md);
          border-radius: var(--radius-xl);
          border: 1px solid rgba(242,183,5,0.35);
          background:
            radial-gradient(ellipse 480px 260px at 50% 0%, rgba(242,183,5,0.16) 0%, transparent 70%),
            linear-gradient(180deg, rgba(11,20,64,0.75) 0%, rgba(6,12,44,0.75) 100%);
          animation: heroFadeIn 0.5s ease;
        }

        .r2r-won--zero {
          border-color: rgba(229,72,77,0.35);
          background:
            radial-gradient(ellipse 480px 260px at 50% 0%, rgba(229,72,77,0.14) 0%, transparent 70%),
            linear-gradient(180deg, rgba(11,20,64,0.75) 0%, rgba(6,12,44,0.75) 100%);
        }

        .r2r-won-eyebrow {
          display: block;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--pale-gold);
          margin-bottom: var(--space-md);
        }

        .r2r-won-tag {
          display: flex;
          justify-content: center;
          animation: r2rTagIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
        }

        @keyframes r2rTagIn {
          from { opacity: 0; transform: scale(0.72); }
          60%  { opacity: 1; transform: scale(1.06); }
          to   { opacity: 1; transform: scale(1); }
        }

        .r2r-won-note {
          margin-top: var(--space-md);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--pale-gold);
        }

        @media (prefers-reduced-motion: reduce) {
          .r2r-won,
          .r2r-won-tag { animation: none; opacity: 1; transform: none; }
        }

        /* Hero */
        .r2r-hero {
          text-align: center;
          padding: var(--space-2xl) var(--space-lg);
          margin-bottom: var(--space-xl);
          background: linear-gradient(135deg, rgba(245,166,35,0.1) 0%, rgba(245,166,35,0.05) 100%);
          border: 1px solid rgba(245,166,35,0.3);
          border-radius: var(--radius-xl);
          animation: heroFadeIn 0.5s ease;
        }

        @keyframes heroFadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .r2r-hero-badge {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: rgba(245,166,35,0.15);
          border: 2px solid var(--warning-amber);
          color: var(--cloud-white);
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-md);
        }

        .r2r-hero-title {
          font-size: 26px;
          margin-bottom: var(--space-xs);
          color: var(--warning-amber);
        }

        .r2r-hero-tagline {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-style: italic;
          color: var(--pale-gold);
          margin-bottom: var(--space-lg);
        }

        .r2r-hero-stats {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: var(--space-lg);
        }

        .r2r-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .r2r-stat-value {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 28px;
          color: var(--cloud-white);
        }

        .r2r-stat-label {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--pale-gold);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 2px;
        }

        .r2r-stat-divider {
          width: 1px;
          height: 40px;
          background: rgba(245,166,35,0.3);
        }

        /* Sections */
        .r2r-section {
          margin-bottom: var(--space-xl);
        }

        .r2r-section-title {
          font-size: 18px;
          margin-bottom: var(--space-md);
          padding-bottom: var(--space-sm);
          border-bottom: 1px solid rgba(245,166,35,0.2);
          color: var(--warning-amber);
        }

        /* Question breakdown */
        .r2r-breakdown {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }

        .r2r-q-row {
          background: rgba(11,20,64,0.6);
          border: 1px solid rgba(245,166,35,0.15);
          border-radius: var(--radius-md);
          padding: 14px 16px;
        }

        .r2r-q-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
        }

        .r2r-q-num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          font-size: 12px;
          flex-shrink: 0;
          background: var(--warning-amber);
          color: var(--deep-midnight);
          font-weight: 700;
          border-radius: 4px;
        }

        .r2r-q-text {
          flex: 1;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--cloud-white);
          line-height: 1.4;
        }

        .r2r-q-detail {
          margin-top: var(--space-sm);
          padding-top: var(--space-sm);
          border-top: 1px solid rgba(245,166,35,0.15);
          display: flex;
          gap: var(--space-lg);
          flex-wrap: wrap;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--pale-gold);
        }

        /* Footer */
        .r2r-footer {
          text-align: center;
          padding: var(--space-lg) 0 var(--space-2xl);
        }

        @media (max-width: 480px) {
          .r2r-won-tag .pt {
            --pt-scale: 0.92;
          }

          .r2r-hero-stats {
            gap: var(--space-md);
          }

          .r2r-stat-value {
            font-size: 22px;
          }

          .r2r-q-header {
            flex-wrap: wrap;
          }

          .r2r-q-detail {
            gap: var(--space-md);
          }
        }
      `}</style>
    </div>
  );
}


/* ===== Helpers ===== */

function getHotSeatQuip(total, responses, questionCount) {
  const correct = responses.filter((r) => r.is_correct).length;
  if (questionCount > 0 && correct === questionCount) return 'A clean sweep. The hot seat has been tamed.';
  if (total === 0) return 'Rough round. The hot seat wins this one.';
  if (correct >= questionCount / 2) return 'Solid nerve under the lights.';
  return 'Survived the spotlight — that counts for something.';
}
