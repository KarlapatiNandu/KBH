import { useState } from 'react';

/**
 * Module 4 — QuestionCard
 *
 * Renders one question with its 4 option pills.
 * After the participant selects an answer, it calls onAnswer and shows feedback.
 *
 * Props:
 *   question        — {id, text, options, correct_option, base_points, order_index}
 *   questionNumber  — 1-indexed display number
 *   totalQuestions   — total question count
 *   onAnswer(index) — callback when an option is selected
 *   disabled        — true after answering or time's up
 *   lastResult      — {is_correct, points_awarded, response_time_ms} or null
 *   revealed        — true once the countdown has ended; until then a pick
 *                     only lights the option gold and the verdict is hidden
 *   selectedOption  — the index the user picked (or null)
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  disabled,
  lastResult,
  revealed = false,
  selectedOption,
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSelect = async (index) => {
    if (disabled || submitting || selectedOption !== null) return;
    setSubmitting(true);
    await onAnswer(index);
    setSubmitting(false);
  };

  // Reveal is gated on the countdown, not on the pick: the verdict only
  // lands once the timer runs out.
  const showVerdict = revealed && lastResult !== null;

  // Derive pill styling based on state
  const getPillClass = (index) => {
    const classes = ['pill', 'qc-pill'];

    if (selectedOption === null) {
      // No answer yet — default styling
      return classes.join(' ');
    }

    if (showVerdict) {
      if (index === question.correct_option) {
        classes.push('qc-pill--correct');
      } else if (index === selectedOption && !lastResult.is_correct) {
        classes.push('qc-pill--wrong');
      } else {
        classes.push('qc-pill--faded');
      }
    } else if (index === selectedOption) {
      // Locked in, verdict pending — the gold highlight
      classes.push('qc-pill--locked');
    } else {
      classes.push('qc-pill--dimmed');
    }

    return classes.join(' ');
  };

  return (
    <div className="q-card qc-card">
      {/* Header */}
      <div className="qc-header">
        <span className="q-badge">{questionNumber}</span>
        <span className="qc-counter">
          Question {questionNumber} of {totalQuestions}
        </span>
        <span className="qc-points">{question.base_points} pts</span>
      </div>

      {/* Question text */}
      <p className="q-text">{question.text}</p>

      {/* Options */}
      <div className="options-grid">
        {question.options.map((option, index) => (
          <button
            key={index}
            className={getPillClass(index)}
            onClick={() => handleSelect(index)}
            disabled={disabled || submitting || selectedOption !== null}
          >
            <span className="pill-num">{OPTION_LABELS[index]}</span>
            <span className="qc-option-text">{option}</span>
            {/* Feedback icon */}
            {showVerdict && index === question.correct_option && (
              <span className="qc-feedback-icon qc-feedback-icon--correct">✓</span>
            )}
            {showVerdict && index === selectedOption && !lastResult.is_correct && index !== question.correct_option && (
              <span className="qc-feedback-icon qc-feedback-icon--wrong">✗</span>
            )}
          </button>
        ))}
      </div>

      {/* Locked in, waiting on the countdown */}
      {selectedOption !== null && !showVerdict && (
        <div className="qc-locked-note">
          <span className="qc-locked-dot" />
          Answer locked in — revealed when the timer ends
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
                : `The correct answer was ${OPTION_LABELS[question.correct_option]}`}
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
        }
      `}</style>
    </div>
  );
}
