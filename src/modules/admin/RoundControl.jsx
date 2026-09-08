import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import QuestionConsole from './QuestionConsole';

/**
 * Module 2 — Round Control
 *
 * Start / end / reset each round, pick the Round 2 hot seat, and (R5) serve
 * questions by hand through the per-round Question Console.
 *
 * The Round 2 hot seat is read from `round_state.active_participant_id`, so a
 * nomination made from the Participants tab or the Live Dashboard shows up
 * here through the same realtime subscription. (R4)
 */

export default function RoundControl() {
  const [round1, setRound1] = useState(null);
  const [round2, setRound2] = useState(null);
  const [questions, setQuestions] = useState({ 1: [], 2: [] });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [participants, setParticipants] = useState([]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchState = useCallback(async () => {
    const { data, error } = await supabase.from('round_state').select('*');
    if (!error && data) {
      setRound1(data.find((r) => r.round === 1) || null);
      setRound2(data.find((r) => r.round === 2) || null);
    }
    setLoading(false);
  }, []);

  const fetchParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('participants')
      .select('id, roll_no, name, network_status')
      .order('roll_no');
    if (data) setParticipants(data);
  }, []);

  const fetchQuestions = useCallback(async () => {
    const { data } = await supabase
      .from('questions')
      .select('id, round, text, base_points, order_index')
      .order('order_index');
    if (data) {
      setQuestions({
        1: data.filter((q) => q.round === 1),
        2: data.filter((q) => q.round === 2),
      });
    }
  }, []);

  useEffect(() => {
    fetchState();
    fetchParticipants();
    fetchQuestions();

    const channel = supabase
      .channel('round-control-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_state' },
        (payload) => {
          // DELETE events carry no `new` row. (ISSUES 3.10)
          const updated = payload.new;
          if (!updated || !updated.round) return;
          if (updated.round === 1) setRound1(updated);
          if (updated.round === 2) setRound2(updated);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchState, fetchParticipants, fetchQuestions]);

  // The hot seat lives in round_state, so a nomination from anywhere shows here.
  const hotSeat = participants.find((p) => p.id === round2?.active_participant_id) || null;

  const startRound = async (round) => {
    const { data, error } = await supabase.rpc('start_round', {
      p_round: round,
      p_active_participant_id: round === 2 ? round2?.active_participant_id ?? null : null,
    });

    if (error || !data?.success) {
      showToast(error?.message || data?.error || `Failed to start Round ${round}`, 'error');
      return;
    }

    showToast(`Round ${round} started`);
    fetchState();
  };

  const endRound = async (round) => {
    const { error } = await supabase
      .from('round_state')
      .update({ status: 'completed' })
      .eq('round', round);

    if (error) {
      showToast(`Failed to end Round ${round}`, 'error');
      return;
    }

    showToast(`Round ${round} ended`);
    fetchState();
  };

  /**
   * Reset goes through the RPC so responses are cleared alongside the index —
   * otherwise the UNIQUE (participant_id, question_id) constraint locks every
   * participant out of a re-run. (ISSUES 1.3)
   */
  const resetRound = async (round, clearResponses) => {
    const { data, error } = await supabase.rpc('reset_round', {
      p_round: round,
      p_clear_responses: clearResponses,
    });

    if (error || !data?.success) {
      showToast(error?.message || data?.error || `Failed to reset Round ${round}`, 'error');
      return;
    }

    showToast(
      clearResponses
        ? `Round ${round} reset — ${data.cleared_responses} responses cleared`
        : `Round ${round} reset to inactive`
    );
    fetchState();
  };

  const nominate = async (participantId) => {
    const { data, error } = await supabase.rpc('nominate_hotseat', {
      p_participant_id: participantId,
    });

    if (error || !data?.success) {
      showToast(error?.message || data?.error || 'Failed to nominate', 'error');
      return;
    }

    showToast(
      participantId ? `${data.roll_no} nominated for the hot seat` : 'Hot seat cleared'
    );
    setSearch('');
    fetchState();
  };

  const filteredParticipants = participants.filter((p) => {
    const q = search.toLowerCase();
    return p.roll_no.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
  });

  if (loading) return <div className="rc-loading">Loading round state…</div>;

  const renderRoundCard = (roundObj, roundNum, title, controls) => {
    if (!roundObj) return null;

    const isActive = roundObj.status === 'active';

    return (
      <div className={`rc-card card ${isActive ? 'rc-card--active' : 'card--solid'}`}>
        <div className="rc-header">
          <div>
            <h3>{title}</h3>
            <span className={`badge badge--${roundObj.status}`}>
              {roundObj.status.toUpperCase()}
            </span>
            {roundObj.manual_mode && (
              <span className="badge badge--completed rc-mode-badge">MANUAL</span>
            )}
          </div>
          <div className="rc-meta">
            {isActive && (
              <span className="rc-question-meta">
                Question {(questions[roundNum].findIndex(
                  (q) => q.order_index === roundObj.current_question_index
                ) + 1) || '—'}
              </span>
            )}
          </div>
        </div>

        <div className="rc-body">{controls}</div>

        <div className="rc-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (window.confirm(
                `Reset Round ${roundNum} and DELETE all its responses?\n\n` +
                `This is what makes the round re-runnable — without it participants ` +
                `are locked out of questions they have already answered.`
              )) {
                resetRound(roundNum, true);
              }
            }}
          >
            Reset &amp; clear responses
          </button>
          {roundObj.status !== 'inactive' && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (window.confirm(`Stop Round ${roundNum} but keep all responses?`)) {
                  resetRound(roundNum, false);
                }
              }}
            >
              Stop (keep responses)
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rc">
      <div className="rc-grid">

        {/* ── Round 1 ── */}
        {renderRoundCard(round1, 1, 'Round 1: Fastest Finger First', (
          <div className="rc-control-box">
            <p className="rc-desc">
              Synchronized round for all participants. Starting it puts the first
              question live for everyone connected.
            </p>

            <QuestionConsole
              round={1}
              roundState={round1}
              questions={questions[1]}
              onResult={showToast}
              onChanged={fetchState}
            />

            <button
              className={`btn ${round1?.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => {
                if (round1?.status === 'active') {
                  if (window.confirm('End Round 1 early?')) endRound(1);
                } else if (window.confirm('Start Round 1 now?')) {
                  startRound(1);
                }
              }}
            >
              {round1?.status === 'active' ? 'End Round 1' : 'Start Round 1'}
            </button>
          </div>
        ))}

        {/* ── Round 2 ── */}
        {renderRoundCard(round2, 2, 'Round 2: Hot Seat', (
          <div className="rc-control-box">
            <p className="rc-desc">
              Nominate one participant for the hot seat. Only they see active
              questions; everyone else gets a disabled placeholder.
            </p>

            <div className="rc-hs-select">
              <label className="form-label">Hot seat</label>

              {hotSeat ? (
                <div className="rc-selected-player">
                  <span className="rc-player-roll">{hotSeat.roll_no}</span>
                  <span className="rc-player-name">{hotSeat.name || '—'}</span>
                  {round2?.status !== 'active' && (
                    <button
                      className="btn-icon rc-clear-hs"
                      title="Clear nomination"
                      onClick={() => nominate(null)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ) : (
                <div className="rc-participant-search">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search participant to nominate…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  {search && (
                    <div className="rc-search-results">
                      {filteredParticipants.slice(0, 5).map((p) => (
                        <div
                          key={p.id}
                          className="rc-search-item"
                          onClick={() => nominate(p.id)}
                        >
                          <span className="rc-item-roll">{p.roll_no}</span>
                          <span
                            className="rc-item-name"
                            style={p.network_status === 'failed'
                              ? { color: 'var(--danger-red)' }
                              : undefined}
                          >
                            {p.name || '—'}
                          </span>
                        </div>
                      ))}
                      {filteredParticipants.length === 0 && (
                        <div className="rc-search-empty">No matches</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <QuestionConsole
              round={2}
              roundState={round2}
              questions={questions[2]}
              onResult={showToast}
              onChanged={fetchState}
            />

            <button
              className={`btn ${round2?.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => {
                if (round2?.status === 'active') {
                  if (window.confirm('End Round 2 early?')) endRound(2);
                } else if (window.confirm(`Start Round 2 for ${hotSeat?.roll_no}?`)) {
                  startRound(2);
                }
              }}
              disabled={round2?.status !== 'active' && !hotSeat}
            >
              {round2?.status === 'active' ? 'End Round 2' : 'Start Round 2'}
            </button>
          </div>
        ))}
      </div>

      {toast && <div className={`toast toast--${toast.type}`}>{toast.message}</div>}

      <style>{`
        .rc-loading {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--serene-seafoam);
        }

        .rc-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-lg);
          max-width: 800px;
          margin: 0 auto;
        }

        .rc-card {
          display: flex;
          flex-direction: column;
        }

        .rc-card--active {
          border-color: var(--ocean-aqua);
          box-shadow: 0 0 0 2px rgba(36,184,175,0.2), var(--shadow-card);
        }

        .rc-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: var(--space-md);
          border-bottom: 1px solid rgba(36,184,175,0.1);
          padding-bottom: var(--space-sm);
        }

        .rc-header h3 {
          font-size: 20px;
          margin-bottom: var(--space-xs);
        }

        .rc-mode-badge { margin-left: 6px; }

        .rc-meta { text-align: right; }

        .rc-question-meta {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--ocean-aqua);
          font-size: 16px;
        }

        .rc-body { flex: 1; }

        .rc-desc {
          color: var(--serene-seafoam);
          font-size: 14px;
          margin-bottom: var(--space-lg);
          line-height: 1.5;
        }

        .rc-control-box {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .rc-hs-select {
          width: 100%;
          margin-bottom: var(--space-lg);
          background: rgba(16, 43, 86, 0.4);
          padding: var(--space-md);
          border-radius: var(--radius-md);
          border: 1px solid rgba(36,184,175,0.1);
        }

        .rc-participant-search {
          position: relative;
          margin-top: var(--space-xs);
        }

        .rc-participant-search input { width: 100%; }

        .rc-search-results {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--deep-midnight);
          border: 1px solid var(--twilight-teal);
          border-radius: var(--radius-md);
          margin-top: 4px;
          max-height: 200px;
          overflow-y: auto;
          z-index: 10;
          box-shadow: var(--shadow-card);
        }

        .rc-search-item {
          padding: 10px 14px;
          display: flex;
          gap: 12px;
          cursor: pointer;
          border-bottom: 1px solid rgba(36,184,175,0.1);
        }

        .rc-search-item:hover { background: rgba(36,184,175,0.08); }

        .rc-item-roll {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--cloud-white);
        }

        .rc-item-name { color: var(--serene-seafoam); }

        .rc-search-empty {
          padding: 10px 14px;
          color: var(--serene-seafoam);
          font-size: 13px;
          text-align: center;
        }

        .rc-selected-player {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: var(--space-xs);
          padding: 12px;
          background: rgba(36,184,175,0.1);
          border: 1px solid var(--twilight-teal);
          border-radius: var(--radius-md);
        }

        .rc-player-roll {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 18px;
          color: var(--ocean-aqua);
        }

        .rc-player-name {
          font-size: 16px;
          font-weight: 500;
        }

        .rc-clear-hs { margin-left: auto; }

        .rc-actions {
          margin-top: var(--space-xl);
          padding-top: var(--space-md);
          border-top: 1px solid rgba(36,184,175,0.1);
          display: flex;
          gap: var(--space-sm);
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        @media (min-width: 768px) {
          .rc-grid {
            grid-template-columns: 1fr 1fr;
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
