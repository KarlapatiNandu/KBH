import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Module 4 — Round1Results
 *
 * Shown after Round 1 completes. Displays:
 *   - Participant's total score + rank
 *   - Per-question breakdown (correct/wrong, points, response time)
 *   - Top-10 leaderboard
 *
 * Props:
 *   participant — { participant_id, roll_no, name }
 *   questions   — all round-1 questions array
 *   onBack()    — callback to return to home
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function Round1Results({ participant, questions, onBack }) {
  const [myResponses, setMyResponses] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState(null);
  const [myTotal, setMyTotal] = useState(0);

  useEffect(() => {
    fetchResults();
  }, []);

  const fetchResults = async () => {
    setLoading(true);

    // 1. Fetch this participant's responses for round 1
    const { data: responses } = await supabase
      .from('responses')
      .select('*')
      .eq('participant_id', participant.participant_id)
      .eq('round', 1)
      .order('created_at');

    if (responses) setMyResponses(responses);

    // 2. Build leaderboard: all participants with their round-1 totals
    const { data: allResponses } = await supabase
      .from('responses')
      .select('participant_id, points_awarded, response_time_ms')
      .eq('round', 1);

    const { data: allParticipants } = await supabase
      .from('participants')
      .select('id, roll_no, name');

    if (allResponses && allParticipants) {
      // Aggregate per participant
      const aggMap = {};
      allResponses.forEach((r) => {
        if (!aggMap[r.participant_id]) {
          aggMap[r.participant_id] = { totalPoints: 0, totalTime: 0, answered: 0 };
        }
        aggMap[r.participant_id].totalPoints += r.points_awarded;
        aggMap[r.participant_id].totalTime += r.response_time_ms;
        aggMap[r.participant_id].answered += 1;
      });

      // Merge with participant info, sort by points desc then time asc
      const board = allParticipants
        .filter((p) => aggMap[p.id])
        .map((p) => ({
          ...p,
          totalPoints: aggMap[p.id].totalPoints,
          totalTime: aggMap[p.id].totalTime,
          answered: aggMap[p.id].answered,
        }))
        .sort((a, b) => {
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
          return a.totalTime - b.totalTime; // Lower time = better
        });

      setLeaderboard(board);

      // Find my rank
      const idx = board.findIndex((p) => p.id === participant.participant_id);
      if (idx !== -1) {
        setMyRank(idx + 1);
        setMyTotal(board[idx].totalPoints);
      }
    }

    setLoading(false);
  };

  // Map question_id → question for easy lookup
  const questionMap = {};
  questions.forEach((q) => {
    questionMap[q.id] = q;
  });

  if (loading) {
    return (
      <div className="r1r-loading">
        <span className="r1r-spinner" />
        <p>Calculating results…</p>
      </div>
    );
  }

  return (
    <div className="r1r">
      {/* Hero Section */}
      <div className="r1r-hero">
        <div className="r1r-hero-badge">
          {myRank ? `#${myRank}` : '—'}
        </div>
        <h2 className="r1r-hero-title">Round 1 Complete!</h2>
        <div className="r1r-hero-stats">
          <div className="r1r-stat">
            <span className="r1r-stat-value">{myTotal}</span>
            <span className="r1r-stat-label">Total Points</span>
          </div>
          <div className="r1r-stat-divider" />
          <div className="r1r-stat">
            <span className="r1r-stat-value">
              {myResponses.filter((r) => r.is_correct).length}/{questions.length}
            </span>
            <span className="r1r-stat-label">Correct</span>
          </div>
          <div className="r1r-stat-divider" />
          <div className="r1r-stat">
            <span className="r1r-stat-value">
              {myRank ? `#${myRank}` : '—'}
            </span>
            <span className="r1r-stat-label">Rank</span>
          </div>
        </div>
      </div>

      {/* Question Breakdown */}
      <div className="r1r-section">
        <h3 className="r1r-section-title">Your Answers</h3>
        <div className="r1r-breakdown">
          {questions.map((q, i) => {
            const resp = myResponses.find((r) => r.question_id === q.id);
            return (
              <div key={q.id} className="r1r-q-row">
                <div className="r1r-q-header">
                  <span className="q-badge r1r-q-num">{i + 1}</span>
                  <span className="r1r-q-text">{q.text}</span>
                  {resp ? (
                    <span className={`badge ${resp.is_correct ? 'badge--correct' : 'badge--wrong'}`}>
                      {resp.is_correct ? '✓ Correct' : '✗ Wrong'}
                    </span>
                  ) : (
                    <span className="badge badge--pending">No Answer</span>
                  )}
                </div>
                {resp && (
                  <div className="r1r-q-detail">
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

      {/* Leaderboard */}
      <div className="r1r-section">
        <h3 className="r1r-section-title">Leaderboard — Top 10</h3>
        <div className="card card--solid r1r-lb-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Roll No</th>
                <th>Name</th>
                <th>Score</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.slice(0, 10).map((p, i) => (
                <tr
                  key={p.id}
                  className={p.id === participant.participant_id ? 'r1r-lb-me' : ''}
                >
                  <td>
                    <span className={`r1r-rank ${i < 3 ? `r1r-rank--${i + 1}` : ''}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="r1r-lb-roll">{p.roll_no}</td>
                  <td>{p.name || '—'}</td>
                  <td className="r1r-lb-score">{p.totalPoints}</td>
                  <td className="r1r-lb-time">{(p.totalTime / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Back button */}
      <div className="r1r-footer">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      <style>{`
        .r1r {
          max-width: 700px;
          margin: 0 auto;
          padding: var(--space-xl) var(--space-md);
        }

        .r1r-loading {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--serene-seafoam);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-md);
        }

        .r1r-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid transparent;
          border-top-color: var(--ocean-aqua);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Hero */
        .r1r-hero {
          text-align: center;
          padding: var(--space-2xl) var(--space-lg);
          margin-bottom: var(--space-xl);
          background: linear-gradient(135deg, rgba(16,43,86,0.92) 0%, rgba(32,76,188,0.88) 100%);
          border: 1px solid rgba(36,184,175,0.2);
          border-radius: var(--radius-xl);
          animation: heroFadeIn 0.5s ease;
        }

        @keyframes heroFadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .r1r-hero-badge {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--ocean-aqua), var(--faded-jade));
          color: var(--deep-midnight);
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-md);
        }

        .r1r-hero-title {
          font-size: 26px;
          margin-bottom: var(--space-lg);
        }

        .r1r-hero-stats {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: var(--space-lg);
        }

        .r1r-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .r1r-stat-value {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 28px;
          color: var(--ocean-aqua);
        }

        .r1r-stat-label {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--serene-seafoam);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 2px;
        }

        .r1r-stat-divider {
          width: 1px;
          height: 40px;
          background: rgba(36,184,175,0.2);
        }

        /* Sections */
        .r1r-section {
          margin-bottom: var(--space-xl);
        }

        .r1r-section-title {
          font-size: 18px;
          margin-bottom: var(--space-md);
          padding-bottom: var(--space-sm);
          border-bottom: 1px solid rgba(36,184,175,0.15);
        }

        /* Question breakdown */
        .r1r-breakdown {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }

        .r1r-q-row {
          background: rgba(16,43,86,0.5);
          border: 1px solid rgba(36,184,175,0.1);
          border-radius: var(--radius-md);
          padding: 14px 16px;
        }

        .r1r-q-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
        }

        .r1r-q-num {
          width: 28px;
          height: 28px;
          font-size: 12px;
          flex-shrink: 0;
        }

        .r1r-q-text {
          flex: 1;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--cloud-white);
          line-height: 1.4;
        }

        .r1r-q-detail {
          margin-top: var(--space-sm);
          padding-top: var(--space-sm);
          border-top: 1px solid rgba(36,184,175,0.08);
          display: flex;
          gap: var(--space-lg);
          flex-wrap: wrap;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--serene-seafoam);
        }

        /* Leaderboard */
        .r1r-lb-card {
          overflow: auto;
        }

        .r1r-lb-me {
          background: rgba(36,184,175,0.1) !important;
        }

        .r1r-lb-me td {
          font-weight: 600;
          color: var(--ocean-aqua) !important;
        }

        .r1r-rank {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 13px;
        }

        .r1r-rank--1 {
          background: linear-gradient(135deg, #FFD700, #FFA000);
          color: #1a1a1a;
        }

        .r1r-rank--2 {
          background: linear-gradient(135deg, #C0C0C0, #9E9E9E);
          color: #1a1a1a;
        }

        .r1r-rank--3 {
          background: linear-gradient(135deg, #CD7F32, #A0522D);
          color: white;
        }

        .r1r-lb-roll {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
        }

        .r1r-lb-score {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          color: var(--ocean-aqua) !important;
        }

        .r1r-lb-time {
          color: var(--serene-seafoam) !important;
        }

        /* Footer */
        .r1r-footer {
          text-align: center;
          padding: var(--space-lg) 0 var(--space-2xl);
        }

        @media (max-width: 480px) {
          .r1r-hero-stats {
            gap: var(--space-md);
          }

          .r1r-stat-value {
            font-size: 22px;
          }

          .r1r-q-header {
            flex-wrap: wrap;
          }

          .r1r-q-detail {
            gap: var(--space-md);
          }
        }
      `}</style>
    </div>
  );
}
