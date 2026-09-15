import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

export default function LiveDashboard() {
  const [round1, setRound1] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [participants, setParticipants] = useState({});
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  // R4 — the host reads this ranking to decide the hot seat, so the
  // nomination action belongs right here on the row.
  const [hotSeatId, setHotSeatId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchInitialData();

    // Subscribe to responses
    const responsesSub = supabase
      .channel('responses-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'responses' },
        (payload) => {
          if (payload.new.round === 1) {
            setResponses((prev) => [...prev, payload.new]);
          }
        }
      )
      .subscribe();

    // Subscribe to round state
    const roundSub = supabase
      .channel('round-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'round_state' },
        (payload) => {
          const updated = payload.new;
          if (!updated || !updated.round) return; // DELETE carries no new row
          if (updated.round === 1) setRound1(updated);
          if (updated.round === 2) setHotSeatId(updated.active_participant_id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(responsesSub);
      supabase.removeChannel(roundSub);
    };
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const nominate = async (participant) => {
    if (!window.confirm(`Nominate ${participant.roll_no} for the Round 2 hot seat?`)) return;

    const { data, error } = await supabase.rpc('nominate_hotseat', {
      p_participant_id: participant.id,
    });

    if (error || !data?.success) {
      showToast(error?.message || data?.error || 'Failed to nominate', 'error');
      return;
    }

    setHotSeatId(participant.id);
    showToast(`${participant.roll_no} nominated for the hot seat`);
  };

  const fetchInitialData = async () => {
    setLoading(true);
    
    // Fetch state
    const { data: rsData } = await supabase.from('round_state').select('*').eq('round', 1).single();
    if (rsData) setRound1(rsData);

    // Current hot seat nomination lives on the round 2 state row
    const { data: r2Data } = await supabase
      .from('round_state')
      .select('active_participant_id')
      .eq('round', 2)
      .single();
    if (r2Data) setHotSeatId(r2Data.active_participant_id);

    // Fetch questions
    const { data: qData } = await supabase.from('questions').select('*').eq('round', 1).order('order_index');
    if (qData) setQuestions(qData);

    // Fetch participants
    const { data: pData } = await supabase.from('participants').select('id, roll_no, name');
    if (pData) {
      const pMap = {};
      pData.forEach(p => { pMap[p.id] = p; });
      setParticipants(pMap);
    }

    // Fetch responses for round 1
    const { data: resData } = await supabase.from('responses').select('*').eq('round', 1);
    if (resData) setResponses(resData);

    setLoading(false);
  };

  // Calculate Leaderboard
  const leaderboard = useMemo(() => {
    const scores = {};
    
    // Initialize everyone who answered at least once (or just everyone in participants, but let's do active)
    responses.forEach(r => {
      if (!scores[r.participant_id]) {
        scores[r.participant_id] = {
          participant_id: r.participant_id,
          total_points: 0,
          total_time_ms: 0,
          answers: {},
        };
      }
      
      scores[r.participant_id].total_points += r.points_awarded;
      scores[r.participant_id].total_time_ms += r.response_time_ms;
      scores[r.participant_id].answers[r.question_id] = {
        is_correct: r.is_correct,
        points: r.points_awarded
      };
    });

    // Convert to array and sort (points DESC, time ASC)
    return Object.values(scores).sort((a, b) => {
      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      return a.total_time_ms - b.total_time_ms;
    });
  }, [responses]);

  const formatTime = (ms) => {
    return (ms / 1000).toFixed(2) + 's';
  };

  if (loading) return <div className="ld-loading">Loading live data…</div>;

  return (
    <div className="ld">
      <div className="ld-header card card--solid">
        <div className="ld-stats">
          <div className="ld-stat">
            <span className="ld-stat-label">Round Status</span>
            <span className={`badge badge--${round1?.status || 'inactive'}`}>
              {(round1?.status || 'inactive').toUpperCase()}
            </span>
          </div>
          <div className="ld-stat">
            <span className="ld-stat-label">Current Question</span>
            <span className="ld-stat-val">
              {round1?.status === 'active' 
                ? `${round1.current_question_index + 1} / ${questions.length}` 
                : '—'
              }
            </span>
          </div>
          <div className="ld-stat">
            <span className="ld-stat-label">Total Responses</span>
            <span className="ld-stat-val">{responses.length}</span>
          </div>
        </div>
      </div>

      <div className="ld-board card">
        <div className="ld-board-header">
          <h3>Round 1 Leaderboard</h3>
          <span className="ld-live-pulse">
            <span className="ld-pulse-dot"></span> Live
          </span>
        </div>

        {leaderboard.length === 0 ? (
          <div className="ld-empty">No responses yet. The silence is deafening.</div>
        ) : (
          <div className="ld-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Rank</th>
                  <th>Participant</th>
                  {questions.map((q, i) => (
                    <th key={q.id} style={{ textAlign: 'center', width: '40px' }} title={q.text}>
                      Q{i + 1}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Total Time</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                  <th style={{ textAlign: 'right' }}>Hot Seat</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, index) => {
                  const p = participants[row.participant_id];
                  if (!p) return null;

                  return (
                    <tr key={p.id}>
                      <td className="ld-rank">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                      </td>
                      <td>
                        <div className="ld-player-info">
                          <span className="ld-roll">{p.roll_no}</span>
                          <span className="ld-name">{p.name || '—'}</span>
                        </div>
                      </td>
                      {questions.map((q) => {
                        const ans = row.answers[q.id];
                        return (
                          <td key={q.id} style={{ textAlign: 'center' }}>
                            {ans ? (
                              <span 
                                className={`ld-ans ${ans.is_correct ? 'ld-ans--correct' : 'ld-ans--wrong'}`}
                                title={ans.is_correct ? `Correct (+${ans.points})` : 'Wrong (0)'}
                              >
                                {ans.is_correct ? '✓' : '✗'}
                              </span>
                            ) : (
                              <span className="ld-ans ld-ans--pending">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--pale-gold)' }}>
                        {formatTime(row.total_time_ms)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '16px', color: 'var(--spotlight-gold)' }}>
                        {row.total_points}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {hotSeatId === p.id ? (
                          <span className="badge badge--active">Nominated</span>
                        ) : (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => nominate(p)}
                            title="Send this participant to the Round 2 hot seat"
                          >
                            Nominate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div className={`toast toast--${toast.type}`}>{toast.message}</div>}

      <style>{`
        .ld-loading {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--pale-gold);
        }

        .ld-header {
          margin-bottom: var(--space-lg);
          padding: var(--space-lg);
        }

        .ld-stats {
          display: flex;
          gap: var(--space-xl);
          flex-wrap: wrap;
        }

        .ld-stat {
          display: flex;
          flex-direction: column;
          gap: var(--space-xs);
        }

        .ld-stat-label {
          font-size: 12px;
          text-transform: uppercase;
          color: var(--pale-gold);
          letter-spacing: 0.5px;
        }

        .ld-stat-val {
          font-family: 'Poppins', sans-serif;
          font-size: 24px;
          font-weight: 700;
          color: var(--cloud-white);
        }

        .ld-board {
          padding: var(--space-lg) 0 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .ld-board-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 var(--space-lg) var(--space-md);
        }

        .ld-board-header h3 {
          font-size: 18px;
        }

        .ld-live-pulse {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--success-green);
          background: var(--success-green-soft);
          padding: 4px 12px;
          border-radius: var(--radius-pill);
        }

        .ld-pulse-dot {
          width: 8px;
          height: 8px;
          background: var(--success-green);
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(74, 188, 132, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(74, 188, 132, 0); }
          100% { box-shadow: 0 0 0 0 rgba(74, 188, 132, 0); }
        }

        .ld-table-wrap {
          overflow-x: auto;
          width: 100%;
        }

        .ld-empty {
          text-align: center;
          padding: var(--space-xl);
          color: var(--pale-gold);
        }

        .ld-rank {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 16px;
          color: var(--pale-gold);
        }

        .ld-player-info {
          display: flex;
          flex-direction: column;
        }

        .ld-roll {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 14px;
        }

        .ld-name {
          font-size: 12px;
          color: var(--pale-gold);
        }

        .ld-ans {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 700;
        }

        .ld-ans--correct {
          background: var(--success-green-soft);
          color: var(--success-green);
        }

        .ld-ans--wrong {
          background: var(--danger-red-soft);
          color: var(--danger-red);
        }

        .ld-ans--pending {
          color: rgba(240, 244, 248, 0.2);
        }
      `}</style>
    </div>
  );
}
