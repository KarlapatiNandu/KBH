import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Module 5 — Round2Results
 *
 * Shown after Round 2 completes for the Hot Seat participant.
 * Displays:
 *   - Total score
 *   - Per-question breakdown (correct/wrong, points, response time)
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function Round2Results({ participant, questions, onBack }) {
  const [myResponses, setMyResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTotal, setMyTotal] = useState(0);

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

    setLoading(false);
  };

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
      {/* Hero Section */}
      <div className="r2r-hero">
        <div className="r2r-hero-badge">🔥</div>
        <h2 className="r2r-hero-title">Hot Seat Complete!</h2>
        <p className="r2r-hero-tagline">{getHotSeatQuip(myTotal, myResponses, questions.length)}</p>
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
