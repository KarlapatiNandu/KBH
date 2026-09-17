import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * R7 — Hot Seat Answer Panel
 *
 * The contestant in the hot seat never taps an answer on their own device;
 * they say it to the host, and the host locks it in here. Goes through
 * host_submit_answer, which resolves the live question and the active
 * participant server-side, then scores it exactly like a normal submission.
 *
 * R9 — locking in is no longer the whole story. The lock-in freezes the
 * contestant's countdown and lights their option gold; the verdict stays
 * hidden until the host hits Reveal below (host_reveal_answer). The timer
 * running out reveals nothing on its own, so the host can hold the moment
 * for as long as the room needs it.
 *
 * Props:
 *   roundState — the round 2 round_state row
 *   questions  — round 2 questions incl. options + correct_option
 *   hotSeat    — the nominated participant ({id, roll_no, name}) or null
 *   onResult(message, type) — toast callback owned by the parent
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function HotSeatAnswerPanel({ roundState, questions, hotSeat, onResult }) {
  const [response, setResponse] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [revealing, setRevealing] = useState(false);

  const isLive = roundState?.status === 'active';
  const liveQuestion = isLive
    ? questions.find((q) => q.order_index === roundState.current_question_index) || null
    : null;
  const position = liveQuestion ? questions.findIndex((q) => q.id === liveQuestion.id) + 1 : 0;

  const fetchResponse = useCallback(async () => {
    if (!liveQuestion || !hotSeat) {
      setResponse(null);
      return;
    }
    const { data, error } = await supabase
      .from('responses')
      .select('selected_option, is_correct, points_awarded, response_time_ms, revealed_at')
      .eq('participant_id', hotSeat.id)
      .eq('question_id', liveQuestion.id)
      .maybeSingle();
    // A missing `revealed_at` column (migration_v6 not run) fails the whole
    // select and would quietly read as "nothing locked in" — worth a line in
    // the console rather than a silently dead panel.
    if (error) console.error('Hot seat response read failed:', error.message);
    setResponse(data || null);
  }, [liveQuestion, hotSeat]);

  // Refetch on every question change (incl. re-serve, via question_started_at)
  // and on any responses write, so a clear-on-serve reopens the buttons.
  useEffect(() => {
    fetchResponse();
    setConfirming(null);
    setRevealing(false);

    const channel = supabase
      .channel('hotseat-answer-panel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'responses' },
        () => fetchResponse()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchResponse, roundState?.question_started_at]);

  const lockIn = async (index) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('host_submit_answer', {
      p_selected_option: index,
    });
    setBusy(false);
    setConfirming(null);

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to lock in answer', 'error');
      fetchResponse();
      return;
    }

    setResponse({
      selected_option: index,
      is_correct: data.is_correct,
      points_awarded: data.points_awarded,
      response_time_ms: data.response_time_ms,
      revealed_at: null,
    });
    // The verdict is for the host's eyes only until they reveal it. (R9)
    onResult(
      data.is_correct
        ? `${OPTION_LABELS[index]} is correct — +${data.points_awarded} pts for ${hotSeat.roll_no}. Their timer is paused; hit Reveal when you're ready.`
        : `${OPTION_LABELS[index]} is wrong — the answer is ${OPTION_LABELS[liveQuestion.correct_option]}. Their timer is paused; hit Reveal when you're ready.`,
      data.is_correct ? 'success' : 'error'
    );
  };

  // R9 — show the verdict on the contestant's screen, on the host's cue.
  const reveal = async () => {
    setRevealing(true);
    const { data, error } = await supabase.rpc('host_reveal_answer');
    setRevealing(false);

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to reveal answer', 'error');
      fetchResponse();
      return;
    }

    setResponse((prev) => (prev ? { ...prev, revealed_at: data.revealed_at } : prev));
    onResult(
      response?.is_correct
        ? `Revealed — ${hotSeat.roll_no} takes +${response.points_awarded} pts`
        : `Revealed — the answer was ${OPTION_LABELS[liveQuestion.correct_option]}`,
      response?.is_correct ? 'success' : 'error'
    );
  };

  if (!isLive) return null;

  if (!hotSeat) {
    return (
      <div className="hsa hsa--empty">
        Round 2 is live but nobody is in the hot seat — nominate a participant above.
      </div>
    );
  }

  if (!liveQuestion) {
    return (
      <div className="hsa hsa--empty">
        No live question — serve one from the console below.
      </div>
    );
  }

  const locked = response !== null;
  const revealed = locked && !!response.revealed_at;

  return (
    <div className="hsa">
      <div className="hsa-head">
        <div>
          <span className="hsa-label">Lock in answer for</span>
          <span className="hsa-player">
            {hotSeat.roll_no}
            {hotSeat.name ? <span className="hsa-player-name"> · {hotSeat.name}</span> : null}
          </span>
        </div>
        <span className="hsa-qnum">
          Q{position} · {liveQuestion.base_points} pts
          {liveQuestion.prize && <span className="hsa-prize"> · {liveQuestion.prize}</span>}
        </span>
      </div>

      <p className="hsa-question">{liveQuestion.text}</p>

      <div className="hsa-options">
        {liveQuestion.options.map((option, index) => {
          const isCorrect = index === liveQuestion.correct_option;
          const isPicked = locked && response.selected_option === index;
          let cls = 'hsa-opt';
          if (locked) {
            if (isCorrect) cls += ' hsa-opt--correct';
            else if (isPicked) cls += ' hsa-opt--wrong';
            else cls += ' hsa-opt--faded';
          } else if (confirming === index) {
            cls += ' hsa-opt--confirming';
          }

          return (
            <button
              key={index}
              className={cls}
              disabled={locked || busy}
              onClick={() => (confirming === index ? lockIn(index) : setConfirming(index))}
              title={locked ? undefined : confirming === index ? 'Click again to lock in' : `Lock in ${OPTION_LABELS[index]}`}
            >
              <span className="hsa-opt-letter">{OPTION_LABELS[index]}</span>
              <span className="hsa-opt-text">{option}</span>
              {!locked && confirming === index && (
                <span className="hsa-opt-confirm">{busy ? 'Locking…' : 'Confirm'}</span>
              )}
              {locked && isCorrect && <span className="hsa-opt-mark">✓</span>}
              {locked && isPicked && !isCorrect && <span className="hsa-opt-mark">✗</span>}
            </button>
          );
        })}
      </div>

      <div className="hsa-foot">
        {locked ? (
          <div className="hsa-locked">
            <span className={`hsa-verdict ${response.is_correct ? 'hsa-verdict--correct' : 'hsa-verdict--wrong'}`}>
              {response.is_correct
                ? `Correct — +${response.points_awarded} pts (${(response.response_time_ms / 1000).toFixed(1)}s)`
                : `Wrong — the answer was ${OPTION_LABELS[liveQuestion.correct_option]}`}
              <span className="hsa-verdict-hint">
                {revealed
                  ? 'Shown on the contestant’s screen. Re-serve with “Clear answers on serve” to replay this question.'
                  : 'Their timer is paused and only the gold lock-in shows — the verdict is still hidden.'}
              </span>
            </span>

            {/* R9 — the host, not the countdown, decides when this lands */}
            {revealed ? (
              <span className="hsa-revealed">
                <span className="hsa-revealed-mark">✓</span> Revealed
              </span>
            ) : (
              <button
                className="hsa-reveal"
                onClick={reveal}
                disabled={revealing}
                title="Show the answer on the contestant’s screen now"
              >
                {revealing ? 'Revealing…' : '👁 Reveal answer'}
              </button>
            )}
          </div>
        ) : confirming !== null ? (
          <span className="hsa-pending">
            Locking in <strong>{OPTION_LABELS[confirming]}</strong> — click it again to confirm, or
            <button className="hsa-cancel" onClick={() => setConfirming(null)}>cancel</button>
          </span>
        ) : (
          <span className="hsa-pending">Waiting for the contestant to say their answer…</span>
        )}
      </div>

      <style>{`
        .hsa {
          width: 100%;
          margin-bottom: var(--space-lg);
          padding: var(--space-md);
          border-radius: var(--radius-md);
          border: 1px solid var(--spotlight-gold);
          background: rgba(242,183,5,0.06);
          box-shadow: 0 0 0 2px rgba(242,183,5,0.12);
        }

        .hsa--empty {
          border-style: dashed;
          border-color: rgba(242,183,5,0.3);
          background: transparent;
          box-shadow: none;
          color: var(--pale-gold);
          font-size: 13px;
          text-align: center;
        }

        .hsa-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: var(--space-sm);
          flex-wrap: wrap;
          margin-bottom: var(--space-sm);
        }

        .hsa-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--pale-gold);
        }

        .hsa-player {
          font-family: 'Poppins', sans-serif;
          font-size: 16px;
          font-weight: 700;
          color: var(--spotlight-gold);
        }

        .hsa-player-name {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--cloud-white);
        }

        .hsa-qnum {
          font-family: 'Poppins', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: var(--pale-gold);
        }

        .hsa-question {
          font-family: 'Poppins', sans-serif;
          font-size: 15px;
          font-weight: 600;
          line-height: 1.4;
          color: var(--cloud-white);
          margin: 0 0 var(--space-md);
        }

        .hsa-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-sm);
        }

        .hsa-opt {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--radius-sm);
          border: 1px solid rgba(242,183,5,0.25);
          background: rgba(11,20,64,0.6);
          color: var(--cloud-white);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .hsa-opt:not(:disabled):hover {
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.12);
        }

        .hsa-opt:disabled { cursor: default; }

        .hsa-opt-letter {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: rgba(242,183,5,0.15);
          color: var(--spotlight-gold);
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 13px;
        }

        .hsa-opt-text {
          flex: 1;
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .hsa-opt-confirm,
        .hsa-opt-mark {
          flex-shrink: 0;
          font-weight: 700;
          font-size: 12px;
        }

        .hsa-opt--confirming {
          border-color: var(--spotlight-gold);
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
          box-shadow: 0 0 0 3px rgba(242,183,5,0.25);
        }

        .hsa-opt--confirming .hsa-opt-letter {
          background: var(--deep-midnight);
          color: var(--spotlight-gold);
        }

        .hsa-opt--correct {
          border-color: var(--success-green);
          background: var(--success-green);
          color: var(--deep-midnight);
        }

        .hsa-opt--correct .hsa-opt-letter {
          background: var(--deep-midnight);
          color: var(--success-green);
        }

        .hsa-opt--wrong {
          border-color: var(--danger-red);
          background: var(--danger-red);
          color: #fff;
        }

        .hsa-opt--wrong .hsa-opt-letter {
          background: rgba(255,255,255,0.2);
          color: #fff;
        }

        .hsa-opt--faded { opacity: 0.4; }

        .hsa-foot {
          margin-top: var(--space-sm);
          font-size: 12px;
          color: var(--pale-gold);
          min-height: 18px;
        }

        .hsa-pending strong { color: var(--spotlight-gold); }

        .hsa-prize { color: var(--spotlight-gold); }

        .hsa-cancel {
          margin-left: 4px;
          padding: 0;
          border: 0;
          background: none;
          color: var(--pale-gold);
          font: inherit;
          text-decoration: underline;
          cursor: pointer;
        }

        .hsa-locked {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-sm);
          flex-wrap: wrap;
        }

        .hsa-verdict {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-weight: 600;
        }

        .hsa-reveal {
          flex-shrink: 0;
          padding: 8px 16px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--spotlight-gold);
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
          font-family: 'Poppins', sans-serif;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          animation: hsaRevealPulse 1.6s ease-in-out infinite;
          transition: all 0.15s ease;
        }

        .hsa-reveal:hover:not(:disabled) {
          filter: brightness(1.1);
        }

        .hsa-reveal:disabled {
          cursor: default;
          opacity: 0.7;
          animation: none;
        }

        @keyframes hsaRevealPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(242,183,5,0.45); }
          50%      { box-shadow: 0 0 0 6px rgba(242,183,5,0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .hsa-reveal { animation: none; }
        }

        .hsa-revealed {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: var(--radius-sm);
          border: 1px solid rgba(242,183,5,0.35);
          color: var(--pale-gold);
          font-family: 'Poppins', sans-serif;
          font-size: 13px;
          font-weight: 600;
        }

        .hsa-revealed-mark { color: var(--success-green); }

        .hsa-verdict--correct { color: var(--success-green); }
        .hsa-verdict--wrong   { color: var(--danger-red); }

        .hsa-verdict-hint {
          font-weight: 400;
          color: var(--pale-gold);
        }

        @media (max-width: 560px) {
          .hsa-options { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
