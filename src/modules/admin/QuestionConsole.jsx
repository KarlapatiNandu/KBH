import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * R5 — Question Console
 *
 * Lets the host drive the round by hand: pick any question and push it live,
 * in any order, at any point. Serving a question turns manual mode on, which
 * stops participant clients auto-advancing past whatever the host just served.
 *
 * Props:
 *   round      — 1 | 2
 *   roundState — the round_state row (may be null while loading)
 *   questions  — this round's questions, ordered by order_index
 *   onResult(message, type) — toast callback owned by the parent
 *   onChanged() — refetch hint for the parent after a write
 */

export default function QuestionConsole({ round, roundState, questions, onResult, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [clearOnServe, setClearOnServe] = useState(false);

  const manualMode = !!roundState?.manual_mode;
  const liveIndex = roundState?.current_question_index;
  const isLiveRound = roundState?.status === 'active';

  const currentPos = questions.findIndex((q) => q.order_index === liveIndex);
  const liveQuestion = currentPos >= 0 ? questions[currentPos] : null;

  const serve = async (question) => {
    setBusyId(question.id);
    const { data, error } = await supabase.rpc('serve_question', {
      p_round: round,
      p_question_id: question.id,
      p_clear_responses: clearOnServe,
    });
    setBusyId(null);

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to serve question', 'error');
      return;
    }

    const cleared = data.cleared_responses
      ? ` (${data.cleared_responses} previous ${data.cleared_responses === 1 ? 'response' : 'responses'} cleared)`
      : '';
    onResult(`Serving question ${questions.findIndex((q) => q.id === question.id) + 1}${cleared}`);
    onChanged?.();
  };

  const toggleManual = async () => {
    const next = !manualMode;
    const { data, error } = await supabase.rpc('set_manual_mode', {
      p_round: round,
      p_manual: next,
    });

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to change mode', 'error');
      return;
    }

    onResult(next ? 'Manual mode on — you serve each question' : 'Auto-advance on');
    onChanged?.();
  };

  const step = (direction) => {
    const target = questions[currentPos + direction];
    if (target) serve(target);
  };

  if (questions.length === 0) {
    return (
      <div className="qc qc--empty">
        No questions for Round {round} yet — add them in the Questions tab.
      </div>
    );
  }

  // The round is live but current_question_index matches no question in it.
  // Participants see nothing but "Waiting for next question…" and there is
  // no other signal that anything is wrong, so surface it where the host is
  // already looking. Serving any question below fixes it.
  const indexOrphaned = isLiveRound && currentPos < 0;

  return (
    <div className="qc">
      {indexOrphaned && (
        <div className="qc-warning">
          Round {round} is live on question index <strong>{String(liveIndex)}</strong>,
          which no question in this round has. Participants are stuck on
          &ldquo;waiting for next question&rdquo;. Serve a question below, or reset
          the round, to recover.
        </div>
      )}

      <div className="qc-toolbar">
        <button
          className={`qc-mode ${manualMode ? 'qc-mode--on' : ''}`}
          onClick={toggleManual}
          title={
            manualMode
              ? 'Participants wait for you between questions'
              : 'Participant clients advance the round themselves when the timer ends'
          }
        >
          <span className="qc-mode-dot" />
          {manualMode ? 'Manual — host serves' : 'Auto-advance'}
        </button>

        <label className="qc-clear-toggle" title="Deletes existing answers for the question you serve, so it can be replayed">
          <input
            type="checkbox"
            checked={clearOnServe}
            onChange={(e) => setClearOnServe(e.target.checked)}
          />
          Clear answers on serve
        </label>
      </div>

      <div className="qc-steppers">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => step(-1)}
          disabled={currentPos <= 0}
        >
          ← Previous
        </button>
        <span className="qc-position">
          {liveQuestion && isLiveRound
            ? `Live: Q${currentPos + 1} of ${questions.length}`
            : `${questions.length} questions`}
        </span>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => step(1)}
          disabled={currentPos < 0 || currentPos >= questions.length - 1}
        >
          Next →
        </button>
      </div>

      <ul className="qc-list">
        {questions.map((q, i) => {
          const isLive = isLiveRound && q.order_index === liveIndex;
          return (
            <li key={q.id} className={`qc-item ${isLive ? 'qc-item--live' : ''}`}>
              <span className="qc-num">{i + 1}</span>
              <span className="qc-text" title={q.text}>{q.text}</span>
              <span className="qc-points">{q.base_points} pts</span>
              {isLive && <span className="badge badge--active qc-live-badge">LIVE</span>}
              <button
                className={`btn btn-sm ${isLive ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => serve(q)}
                disabled={busyId === q.id}
              >
                {busyId === q.id ? 'Serving…' : isLive ? 'Re-serve' : 'Serve'}
              </button>
            </li>
          );
        })}
      </ul>

      <style>{`
        .qc {
          width: 100%;
          margin-bottom: var(--space-lg);
          background: rgba(16, 43, 86, 0.4);
          border: 1px solid rgba(36,184,175,0.1);
          border-radius: var(--radius-md);
          padding: var(--space-md);
        }

        .qc--empty {
          color: var(--serene-seafoam);
          font-size: 13px;
          text-align: center;
          padding: var(--space-lg) var(--space-md);
        }

        .qc-warning {
          margin-bottom: var(--space-md);
          padding: 10px 14px;
          border: 1px solid var(--danger-red);
          background: var(--danger-red-soft);
          border-radius: var(--radius-sm);
          font-size: 13px;
          line-height: 1.5;
          color: var(--danger-red);
        }

        .qc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-sm);
          flex-wrap: wrap;
          margin-bottom: var(--space-md);
        }

        .qc-mode {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(36,184,175,0.25);
          background: transparent;
          color: var(--serene-seafoam);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .qc-mode:hover { border-color: var(--ocean-aqua); color: var(--cloud-white); }

        .qc-mode--on {
          border-color: var(--warning-amber);
          color: var(--warning-amber);
          background: var(--warning-amber-soft);
        }

        .qc-mode-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }

        .qc-clear-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--serene-seafoam);
          cursor: pointer;
        }

        .qc-steppers {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-sm);
          padding-bottom: var(--space-md);
          margin-bottom: var(--space-sm);
          border-bottom: 1px solid rgba(36,184,175,0.1);
        }

        .qc-position {
          font-family: 'Poppins', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: var(--ocean-aqua);
          text-align: center;
        }

        .qc-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 320px;
          overflow-y: auto;
        }

        .qc-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          border: 1px solid transparent;
        }

        .qc-item:hover { background: rgba(36,184,175,0.06); }

        .qc-item--live {
          border-color: var(--ocean-aqua);
          background: rgba(36,184,175,0.1);
        }

        .qc-num {
          width: 22px;
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 13px;
          color: var(--serene-seafoam);
        }

        .qc-text {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          color: var(--cloud-white);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .qc-points {
          flex-shrink: 0;
          font-size: 12px;
          color: var(--serene-seafoam);
        }

        .qc-live-badge { flex-shrink: 0; }

        @media (max-width: 560px) {
          .qc-points { display: none; }
        }
      `}</style>
    </div>
  );
}
