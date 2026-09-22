import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import Round1Panel from './Round1Panel';
import Round2Panel from './Round2Panel';
import { rungForQuestion } from './tiers';

/**
 * Module 2 — Round Control
 *
 * Start / end / reset each round, and hand each round's own controls to its
 * own panel: Round1Panel and Round2Panel. This file is now the three things
 * the two rounds genuinely share — the round_state read, the round lifecycle
 * (start / end / reset), and the card the panels sit in.
 *
 * The Round 2 hot seat is read from `round_state.active_participant_id`, so a
 * nomination made from the Participants tab or the Live Dashboard shows up
 * here through the same realtime subscription. (R4)
 *
 * The layout: Round 2 carries the hot seat, the lifelines, the ladder and a
 * tiered question pool; Round 1 carries a console and a button. Two equal
 * columns therefore made Round 1 a mostly-empty half of the screen stretched
 * to Round 2's height. It now sits in a column sized to its content, at the
 * top of the row, and the row only splits once there is actually width for
 * both — measured on the content area rather than the window, because the
 * sidebar takes 260px of the window that this layout never sees.
 */

export default function RoundControl() {
  const [round1, setRound1] = useState(null);
  const [round2, setRound2] = useState(null);
  const [questions, setQuestions] = useState({ 1: [], 2: [] });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
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
    const [r1, r2] = await Promise.all([
      // R19 — Round 1 has its own table.
      supabase.from('round1_questions').select('*').order('order_index'),
      supabase
        .from('questions')
        // `select('*')`, not a column list. Naming `ladder_level` (R16) makes
        // the whole read fail on a database that has not run migration_v11,
        // and a failed read here reads back as "this round has no questions" —
        // the same trap HotSeatAnswerPanel documents for `revealed_at`. The
        // extra columns cost nothing; the panels take what they need.
        .select('*')
        .eq('round', 2)
        .order('order_index'),
    ]);
    setQuestions((prev) => ({
      1: r1.data ? r1.data.map((q) => ({ ...q, round: 1 })) : prev[1],
      2: r2.data || prev[2],
    }));
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

  if (loading) return <div className="rc-loading">Loading round state…</div>;

  /**
   * What the header says is live. Round 1 counts questions, because that is
   * what its round is — a fixed queue. Round 2 counts rungs: with a pool per
   * tier (R16) the question's position in the list is a number about the
   * question bank, not about the run the room is watching.
   */
  const liveMeta = (roundObj, roundNum) => {
    const live = questions[roundNum].find(
      (q) => q.order_index === roundObj.current_question_index
    );
    if (!live) return 'Question —';

    if (roundNum === 2) {
      const rung = rungForQuestion(live, questions[2]);
      return rung == null ? 'Off the ladder' : `Rung ${rung}`;
    }

    return `Question ${questions[roundNum].indexOf(live) + 1}`;
  };

  const renderRoundCard = (roundObj, roundNum, title, controls) => {
    if (!roundObj) return null;

    const isActive = roundObj.status === 'active';

    return (
      <div className={`rc-card card ${isActive ? 'rc-card--active' : 'card--solid'}`}>
        <div className="rc-header">
          <div className="rc-title">
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
              <span className="rc-question-meta">{liveMeta(roundObj, roundNum)}</span>
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

        {renderRoundCard(round1, 1, 'Round 1: Fastest Finger First', (
          <Round1Panel
            roundState={round1}
            questions={questions[1]}
            onResult={showToast}
            onChanged={fetchState}
            onStart={() => startRound(1)}
            onEnd={() => endRound(1)}
          />
        ))}

        {renderRoundCard(round2, 2, 'Round 2: Hot Seat', (
          <Round2Panel
            roundState={round2}
            questions={questions[2]}
            participants={participants}
            hotSeat={hotSeat}
            onResult={showToast}
            onChanged={fetchState}
            onStart={() => startRound(2)}
            onEnd={() => endRound(2)}
          />
        ))}
      </div>

      {toast && <div className={`toast toast--${toast.type}`}>{toast.message}</div>}

      <style>{`
        .rc-loading {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--pale-gold);
        }

        .rc {
          /* The breakpoints below are about how much room these two cards
             have, which is the window minus a 260px sidebar and the content
             padding. Measuring the window instead is what made a "desktop"
             layout appear at 768px in a 444px-wide column. */
          container: rc / inline-size;
        }

        .rc-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: var(--space-lg);
          /* Round 1 is a console and a button; Round 2 is the whole hot seat.
             Stretching the short card to the tall one's height just to keep
             the row tidy leaves a half-screen of empty gradient under it. */
          align-items: start;
          max-width: 800px;
          margin: 0 auto;
        }

        .rc-card {
          display: flex;
          flex-direction: column;
          /* Grid items are min-width:auto, so the widest thing inside either
             card — a long question, a row of buttons — could push its column
             past the track and the whole page sideways. This is the fix for
             the admin's horizontal scrollbar. */
          min-width: 0;
        }

        .rc-card--active {
          border-color: var(--spotlight-gold);
          box-shadow: 0 0 0 2px rgba(242,183,5,0.2), var(--shadow-card);
        }

        .rc-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-sm);
          flex-wrap: wrap;
          margin-bottom: var(--space-md);
          border-bottom: 1px solid rgba(242,183,5,0.1);
          padding-bottom: var(--space-sm);
        }

        .rc-title { min-width: 0; }

        .rc-header h3 {
          font-size: 20px;
          margin-bottom: var(--space-xs);
        }

        .rc-mode-badge { margin-left: 6px; }

        .rc-meta {
          text-align: right;
          flex-shrink: 0;
        }

        .rc-question-meta {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--spotlight-gold);
          font-size: 16px;
        }

        .rc-body {
          flex: 1;
          min-width: 0;
        }

        .rc-actions {
          margin-top: var(--space-xl);
          padding-top: var(--space-md);
          border-top: 1px solid rgba(242,183,5,0.1);
          display: flex;
          gap: var(--space-sm);
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        /* ── Phone ── */
        @media (max-width: 560px) {
          .rc-card {
            /* .card's 28px sides cost a phone a fifth of its width. */
            padding: var(--space-md) var(--space-md) var(--space-lg);
          }

          .rc-header h3 { font-size: 17px; }

          .rc-meta { text-align: left; }

          /* Two full-width rows, in reading order. Side by side these wrap to
             a ragged pair of half-buttons, and one of them deletes responses. */
          .rc-actions {
            justify-content: stretch;
            flex-direction: column;
          }

          .rc-actions .btn { width: 100%; }
        }

        /* ── Two columns, once the content area can hold both ── */
        @container rc (min-width: 860px) {
          .rc-grid {
            /* Round 1 gets what it needs and no more; Round 2 takes the rest. */
            grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
            max-width: 100%;
          }
        }

        @container rc (min-width: 1180px) {
          .rc-grid {
            grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
            max-width: 1500px;
          }
        }

        /* Without containment the queries above never match and the grid
           stays one column — correct, but needlessly narrow on a desktop.
           Fall back to the window, minus the sidebar and padding. */
        @supports not (container-type: inline-size) {
          @media (min-width: 1184px) {
            .rc-grid {
              grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
              max-width: 100%;
            }
          }

          @media (min-width: 1504px) {
            .rc-grid {
              grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
              max-width: 1500px;
            }
          }
        }
      `}</style>
    </div>
  );
}
