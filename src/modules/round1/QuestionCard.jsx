import { useState } from 'react';
import {
  QUESTION_TYPES,
  optionLabel,
  typeOf,
  normalizeAnswer,
  isAnswerComplete,
  formatAnswer,
} from './answers';

/**
 * Module 4 — QuestionCard
 *
 * Renders one question with its option pills.
 * After the participant locks in an answer, it calls onAnswer and shows feedback.
 *
 * R19 — three kinds of question (see answers.js):
 *   single   — tapping an option locks it in, as it always has.
 *   multiple — taps toggle options on and off; Lock in submits the set.
 *   order    — taps number the options 1, 2, 3…; tapping a numbered option
 *              takes it back out. Lock in submits once every option has a
 *              place. Tap-to-number rather than drag-to-sort because it
 *              works the same with a thumb on a phone as with a mouse.
 *
 * Props:
 *   question        — a round1_questions row
 *   questionNumber  — 1-indexed display number
 *   totalQuestions  — total question count
 *   onAnswer(answer) — callback with the answer array once locked in
 *   disabled        — true after answering or time's up
 *   lastResult      — {is_correct, points_awarded, response_time_ms} or null
 *   revealed        — true once the countdown has ended; until then a pick
 *                     only lights the option gold and the verdict is hidden
 *   selectedAnswer  — the answer array locked in (or null)
 *
 * Mount it with a key per served question: the unlocked picks live here.
 */

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  disabled,
  lastResult,
  revealed = false,
  selectedAnswer,
}) {
  const [submitting, setSubmitting] = useState(false);
  // Picks not yet locked in — multiple and order only.
  const [draft, setDraft] = useState([]);

  const type = typeOf(question);
  const optionCount = question.options.length;
  const correct = question.correct_answer || [];
  const locked = selectedAnswer != null;
  const inputOpen = !disabled && !submitting && !locked;
  // What the pills are marked with: the locked answer, or the picks so far.
  const marked = locked ? selectedAnswer : draft;

  const submit = async (answer) => {
    if (!inputOpen || !isAnswerComplete(type, answer, optionCount)) return;
    setSubmitting(true);
    await onAnswer(normalizeAnswer(type, answer));
    setSubmitting(false);
  };

  const handleTap = (index) => {
    if (!inputOpen) return;

    if (type === 'single') {
      submit([index]);
      return;
    }

    // Toggling suits both: a set loses the option, a sequence closes up
    // behind it.
    setDraft((d) => (d.includes(index) ? d.filter((i) => i !== index) : [...d, index]));
  };

  // Reveal is gated on the countdown, not on the pick: the verdict only
  // lands once the timer runs out.
  const showVerdict = revealed && lastResult !== null;

  // Derive pill styling based on state
  const getPillClass = (index) => {
    const classes = ['pill', 'qc-pill'];
    const isMarked = marked.includes(index);

    if (showVerdict) {
      if (type === 'order') {
        classes.push(marked.indexOf(index) === correct.indexOf(index) ? 'qc-pill--correct' : 'qc-pill--wrong');
      } else if (correct.includes(index)) {
        classes.push('qc-pill--correct');
      } else if (isMarked) {
        classes.push('qc-pill--wrong');
      } else {
        classes.push('qc-pill--faded');
      }
    } else if (locked) {
      // Locked in, verdict pending — the gold highlight
      classes.push(isMarked ? 'qc-pill--locked' : 'qc-pill--dimmed');
    } else if (isMarked) {
      classes.push('qc-pill--picked');
    }

    return classes.join(' ');
  };

  const hint = QUESTION_TYPES[type].hint;
  const answerWord = type === 'order' ? 'order' : 'answer';

  return (
    <div className="q-card qc-card">
      {/* Header */}
      <div className="qc-header">
        <span className="q-badge">{questionNumber}</span>
        <span className="qc-counter">
          Question {questionNumber} of {totalQuestions}
        </span>
        <span className={`qc-type qc-type--${type}`}>{QUESTION_TYPES[type].label}</span>
        <span className="qc-points">{question.base_points} pts</span>
      </div>

      {/* Question text */}
      <p className="q-text">{question.text}</p>
      {hint && !locked && <p className="qc-hint">{hint}</p>}

      {/* Options */}
      <div className="options-grid">
        {question.options.map((option, index) => {
          const position = marked.indexOf(index);
          const correctPosition = correct.indexOf(index);
          const isCorrect = type === 'order' ? position === correctPosition : correct.includes(index);

          return (
            <button
              key={index}
              className={getPillClass(index)}
              onClick={() => handleTap(index)}
              disabled={!inputOpen}
              aria-pressed={type === 'single' ? undefined : position !== -1}
            >
              <span className="pill-num">{optionLabel(index)}</span>
              <span className="qc-option-text">{option}</span>
              {type === 'order' && position !== -1 && (
                <span className="qc-seq" title={`Position ${position + 1}`}>{position + 1}</span>
              )}
              {type === 'order' && showVerdict && !isCorrect && (
                <span className="qc-seq-fix" title="Its place in the correct order">→ {correctPosition + 1}</span>
              )}
              {/* Feedback icon */}
              {showVerdict && type !== 'order' && isCorrect && (
                <span className="qc-feedback-icon qc-feedback-icon--correct">✓</span>
              )}
              {showVerdict && type !== 'order' && !isCorrect && position !== -1 && (
                <span className="qc-feedback-icon qc-feedback-icon--wrong">✗</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Multiple / order: the picks so far and the lock-in */}
      {type !== 'single' && !locked && !disabled && (
        <div className="qc-lock-row">
          <span className="qc-lock-count">
            {type === 'order'
              ? `${draft.length} of ${optionCount} placed`
              : `${draft.length} selected`}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setDraft([])}
            disabled={draft.length === 0 || submitting}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => submit(draft)}
            disabled={!isAnswerComplete(type, draft, optionCount) || submitting}
          >
            Lock in
          </button>
        </div>
      )}

      {/* Locked in, waiting on the countdown */}
      {locked && !showVerdict && (
        <div className="qc-locked-note">
          <span className="qc-locked-dot" />
          {type === 'order' ? 'Order' : 'Answer'} locked in — revealed when the timer ends
        </div>
      )}

      {/* Time ran out with nothing locked in */}
      {revealed && lastResult === null && !locked && (
        <div className="qc-result qc-result--wrong">
          <span className="qc-result-icon">⏱</span>
          <div className="qc-result-text">
            <strong>Time&rsquo;s up</strong>
            <span className="qc-result-detail">
              {draft.length > 0 ? 'Not locked in in time. ' : ''}
              The correct {answerWord} was {formatAnswer(type, correct)}
            </span>
          </div>
        </div>
      )}

      {/* Result feedback */}
      {showVerdict && (
        <div className={`qc-result ${lastResult.is_correct ? 'qc-result--correct' : 'qc-result--wrong'}`}>
          <span className="qc-result-icon">
            {lastResult.is_correct ? '🎯' : '❌'}
          </span>
          <div className="qc-result-text">
            <strong>
              {lastResult.is_correct ? 'Correct!' : 'Wrong!'}
            </strong>
            <span className="qc-result-detail">
              {lastResult.is_correct
                ? `+${lastResult.points_awarded} points (${(lastResult.response_time_ms / 1000).toFixed(1)}s)`
                : `The correct ${answerWord} was ${formatAnswer(type, correct)}`}
            </span>
          </div>
        </div>
      )}

      {/* Submitting overlay */}
      {submitting && (
        <div className="qc-submitting">
          <span className="qc-submitting-dot" />
          Submitting…
        </div>
      )}

      <style>{`
        .qc-card {
          position: relative;
          overflow: hidden;
        }

        .qc-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          margin-bottom: var(--space-xs);
        }

        .qc-counter {
          flex: 1;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--pale-gold);
        }

        .qc-points {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: var(--spotlight-gold);
          background: rgba(242,183,5,0.12);
          padding: 3px 10px;
          border-radius: var(--radius-pill);
        }

        /* R19 — which kind of question this is */
        .qc-type {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 3px 10px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(242,183,5,0.35);
          color: var(--pale-gold);
          white-space: nowrap;
        }

        .qc-type--multiple,
        .qc-type--order {
          border-color: var(--spotlight-gold);
          color: var(--spotlight-gold);
        }

        .qc-hint {
          margin: calc(var(--space-sm) * -1) 0 var(--space-md);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--pale-gold);
        }

        /* Picked but not locked in yet — multiple and order */
        .qc-pill--picked {
          border-color: var(--spotlight-gold) !important;
          background: rgba(242,183,5,0.16) !important;
          box-shadow: 0 0 0 1px var(--spotlight-gold);
        }

        .qc-seq {
          flex-shrink: 0;
          margin-left: auto;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Poppins', sans-serif;
          font-size: 13px;
          font-weight: 700;
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
        }

        .qc-pill--locked .qc-seq,
        .qc-pill--correct .qc-seq {
          background: var(--deep-midnight);
          color: var(--spotlight-gold);
        }

        .qc-pill--wrong .qc-seq {
          background: rgba(255,255,255,0.2);
          color: white;
        }

        .qc-seq-fix {
          flex-shrink: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .qc-lock-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-sm);
          margin-top: var(--space-md);
          flex-wrap: wrap;
        }

        .qc-lock-count {
          flex: 1;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--pale-gold);
        }

        .qc-pill {
          text-align: left;
          transition: all 0.25s ease;
          position: relative;
        }

        .qc-pill:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .qc-pill:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 12px rgba(242,183,5,0.15);
        }

        .qc-option-text {
          flex: 1;
        }

        /* Locked in: the gold graphic that marks the chosen option while
           the countdown finishes running. */
        .qc-pill--locked {
          background: linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 55%, var(--amber-glow) 100%) !important;
          border-color: var(--champagne-gold) !important;
          color: var(--deep-midnight) !important;
          font-weight: 600;
          opacity: 1 !important;
          box-shadow: 0 0 0 2px rgba(242,183,5,0.28), 0 4px 18px rgba(242,183,5,0.35);
          animation: qcLockedGlow 1.6s ease-in-out infinite;
        }

        .qc-pill--locked .pill-num {
          background: var(--deep-midnight);
          color: var(--spotlight-gold);
        }

        @keyframes qcLockedGlow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(242,183,5,0.28), 0 4px 18px rgba(242,183,5,0.30); }
          50%      { box-shadow: 0 0 0 3px rgba(242,183,5,0.45), 0 6px 26px rgba(242,183,5,0.55); }
        }

        /* The options not chosen, while the verdict is still pending */
        .qc-pill--dimmed {
          opacity: 0.5 !important;
        }

        .qc-locked-note {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-sm);
          margin-top: var(--space-md);
          padding: 10px 16px;
          border-radius: var(--radius-md);
          border: 1px dashed rgba(242,183,5,0.35);
          background: rgba(242,183,5,0.06);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--pale-gold);
        }

        .qc-locked-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--spotlight-gold);
          animation: dotPulse 1.2s ease-in-out infinite;
        }

        /* Feedback states */
        .qc-pill--correct {
          background: var(--success-green) !important;
          border-color: var(--success-green) !important;
          color: var(--deep-midnight) !important;
          opacity: 1 !important;
        }

        .qc-pill--correct .pill-num {
          background: var(--deep-midnight);
          color: var(--success-green);
        }

        .qc-pill--wrong {
          background: var(--danger-red) !important;
          border-color: var(--danger-red) !important;
          color: white !important;
          opacity: 1 !important;
        }

        .qc-pill--wrong .pill-num {
          background: rgba(255,255,255,0.2);
          color: white;
        }

        .qc-pill--faded {
          opacity: 0.35 !important;
        }

        .qc-feedback-icon {
          flex-shrink: 0;
          font-weight: 700;
          font-size: 16px;
          margin-left: auto;
        }

        .qc-feedback-icon--correct {
          color: var(--deep-midnight);
        }

        .qc-feedback-icon--wrong {
          color: white;
        }

        /* Result bar */
        .qc-result {
          display: flex;
          align-items: center;
          gap: var(--space-md);
          margin-top: var(--space-md);
          padding: 14px 18px;
          border-radius: var(--radius-md);
          animation: resultSlideIn 0.3s ease;
        }

        .qc-result--correct {
          background: var(--success-green-soft);
          border: 1px solid rgba(74,188,132,0.3);
        }

        .qc-result--wrong {
          background: var(--danger-red-soft);
          border: 1px solid rgba(231,76,94,0.3);
        }

        .qc-result-icon {
          font-size: 24px;
          flex-shrink: 0;
        }

        .qc-result-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .qc-result-text strong {
          font-family: 'Poppins', sans-serif;
          font-size: 16px;
          color: var(--cloud-white);
        }

        .qc-result-detail {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--pale-gold);
        }

        @keyframes resultSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Submitting overlay */
        .qc-submitting {
          position: absolute;
          inset: 0;
          background: rgba(11,20,64,0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-sm);
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          color: var(--spotlight-gold);
          border-radius: var(--radius-lg);
          z-index: 5;
        }

        .qc-submitting-dot {
          width: 8px;
          height: 8px;
          background: var(--spotlight-gold);
          border-radius: 50%;
          animation: dotPulse 0.8s ease-in-out infinite;
        }

        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }

        @media (max-width: 480px) {
          .qc-header {
            flex-wrap: wrap;
          }

          .qc-lock-row .btn { flex: 1; }
          .qc-lock-count { flex-basis: 100%; }
        }
      `}</style>
    </div>
  );
}
