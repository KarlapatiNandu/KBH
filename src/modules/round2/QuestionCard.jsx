import { useState } from 'react';

/**
 * Module 5 — QuestionCard (Round 2)
 *
 * Renders one question with its 4 option pills.
 *
 * Props:
 *   question        — {id, text, options, correct_option, base_points, order_index}
 *   questionNumber  — 1-indexed display number
 *   totalQuestions   — total question count
 *   onAnswer(index) — callback when an option is selected
 *   disabled        — true after answering or time's up
 *   lastResult      — {is_correct, points_awarded, response_time_ms} or null
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
  selectedOption,
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSelect = async (index) => {
    if (disabled || submitting || selectedOption !== null) return;
    setSubmitting(true);
    await onAnswer(index);
    setSubmitting(false);
  };

  // Derive pill styling based on state
  const getPillClass = (index) => {
    const classes = ['r2-pill', 'r2-qc-pill'];

    if (selectedOption === null) {
      return classes.join(' ');
    }

    if (lastResult) {
      if (index === question.correct_option) {
        classes.push('r2-qc-pill--correct');
      } else if (index === selectedOption && !lastResult.is_correct) {
        classes.push('r2-qc-pill--wrong');
      } else {
        classes.push('r2-qc-pill--faded');
      }
    } else if (index === selectedOption) {
      classes.push('r2-pill--selected');
    }

    return classes.join(' ');
  };

  return (
    <div className="r2-q-card r2-qc-card">
      {/* Header */}
      <div className="r2-qc-header">
        <span className="r2-q-badge">{questionNumber}</span>
        <span className="r2-qc-counter">
          Question {questionNumber} of {totalQuestions}
        </span>
        <span className="r2-qc-points">{question.base_points} pts</span>
      </div>

      {/* Question text */}
      <p className="r2-q-text">{question.text}</p>

      {/* Options */}
      <div className="r2-options-grid">
        {question.options.map((option, index) => (
          <button
            key={index}
            className={getPillClass(index)}
            onClick={() => handleSelect(index)}
            disabled={disabled || submitting || selectedOption !== null}
          >
            <span className="r2-pill-num">{OPTION_LABELS[index]}</span>
            <span className="r2-qc-option-text">{option}</span>
            {/* Feedback icon */}
            {lastResult && index === question.correct_option && (
              <span className="r2-qc-feedback-icon r2-qc-feedback-icon--correct">✓</span>
            )}
            {lastResult && index === selectedOption && !lastResult.is_correct && index !== question.correct_option && (
              <span className="r2-qc-feedback-icon r2-qc-feedback-icon--wrong">✗</span>
            )}
          </button>
        ))}
      </div>

      {/* Result feedback */}
      {lastResult && (
        <div className={`r2-qc-result ${lastResult.is_correct ? 'r2-qc-result--correct' : 'r2-qc-result--wrong'}`}>
          <span className="r2-qc-result-icon">
            {lastResult.is_correct ? '🔥' : '❌'}
          </span>
          <div className="r2-qc-result-text">
            <strong>
              {lastResult.is_correct ? 'Correct!' : 'Wrong!'}
            </strong>
            <span className="r2-qc-result-detail">
              {lastResult.is_correct
                ? `+${lastResult.points_awarded} points (${(lastResult.response_time_ms / 1000).toFixed(1)}s)`
                : `The correct answer was ${OPTION_LABELS[question.correct_option]}`}
            </span>
          </div>
        </div>
      )}

      {/* Submitting overlay */}
      {submitting && (
        <div className="r2-qc-submitting">
          <span className="r2-qc-submitting-dot" />
          Submitting…
        </div>
      )}

      <style>{`
        .r2-q-card {
          background: rgba(16,43,86,0.6);
          border: 1px solid rgba(245,166,35,0.2);
          border-radius: var(--radius-lg);
          padding: var(--space-xl);
          box-shadow: var(--shadow-card);
        }
        
        .r2-qc-card {
          position: relative;
          overflow: hidden;
        }

        .r2-qc-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          margin-bottom: var(--space-xs);
        }
        
        .r2-q-badge {
          background: var(--warning-amber);
          color: var(--deep-midnight);
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 14px;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .r2-qc-counter {
          flex: 1;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--warning-amber);
        }

        .r2-qc-points {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: var(--warning-amber);
          background: rgba(245,166,35,0.12);
          padding: 3px 10px;
          border-radius: var(--radius-pill);
        }
        
        .r2-q-text {
          font-family: 'Poppins', sans-serif;
          font-size: 22px;
          font-weight: 600;
          color: var(--cloud-white);
          margin: var(--space-md) 0 var(--space-xl);
          line-height: 1.4;
        }
        
        .r2-options-grid {
          display: grid;
          gap: var(--space-md);
        }

        .r2-pill {
          display: flex;
          align-items: center;
          gap: var(--space-md);
          width: 100%;
          padding: 16px 20px;
          background: rgba(36,184,175,0.05);
          border: 1px solid rgba(36,184,175,0.2);
          border-radius: var(--radius-md);
          color: var(--cloud-white);
          font-family: 'Inter', sans-serif;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
        }
        
        .r2-pill-num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(36,184,175,0.15);
          color: var(--ocean-aqua);
          font-weight: 600;
          font-size: 14px;
        }

        .r2-qc-pill {
          text-align: left;
          transition: all 0.25s ease;
          position: relative;
        }

        .r2-qc-pill:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .r2-qc-pill:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 12px rgba(245,166,35,0.15);
          border-color: rgba(245,166,35,0.4);
        }
        
        .r2-pill--selected {
          border-color: var(--warning-amber);
          background: rgba(245,166,35,0.1);
        }

        .r2-qc-option-text {
          flex: 1;
        }

        /* Feedback states */
        .r2-qc-pill--correct {
          background: var(--success-green) !important;
          border-color: var(--success-green) !important;
          color: var(--deep-midnight) !important;
          opacity: 1 !important;
        }

        .r2-qc-pill--correct .r2-pill-num {
          background: var(--deep-midnight);
          color: var(--success-green);
        }

        .r2-qc-pill--wrong {
          background: var(--danger-red) !important;
          border-color: var(--danger-red) !important;
          color: white !important;
          opacity: 1 !important;
        }

        .r2-qc-pill--wrong .r2-pill-num {
          background: rgba(255,255,255,0.2);
          color: white;
        }

        .r2-qc-pill--faded {
          opacity: 0.35 !important;
        }

        .r2-qc-feedback-icon {
          flex-shrink: 0;
          font-weight: 700;
          font-size: 16px;
          margin-left: auto;
        }

        .r2-qc-feedback-icon--correct {
          color: var(--deep-midnight);
        }

        .r2-qc-feedback-icon--wrong {
          color: white;
        }

        /* Result bar */
        .r2-qc-result {
          display: flex;
          align-items: center;
          gap: var(--space-md);
          margin-top: var(--space-md);
          padding: 14px 18px;
          border-radius: var(--radius-md);
          animation: r2resultSlideIn 0.3s ease;
        }

        .r2-qc-result--correct {
          background: rgba(74,188,132,0.15);
          border: 1px solid rgba(74,188,132,0.4);
        }

        .r2-qc-result--wrong {
          background: var(--danger-red-soft);
          border: 1px solid rgba(231,76,94,0.3);
        }

        .r2-qc-result-icon {
          font-size: 24px;
          flex-shrink: 0;
        }

        .r2-qc-result-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .r2-qc-result-text strong {
          font-family: 'Poppins', sans-serif;
          font-size: 16px;
          color: var(--cloud-white);
        }

        .r2-qc-result-detail {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: rgba(240, 244, 248, 0.8);
        }

        @keyframes r2resultSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Submitting overlay */
        .r2-qc-submitting {
          position: absolute;
          inset: 0;
          background: rgba(16,43,86,0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-sm);
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          color: var(--warning-amber);
          border-radius: var(--radius-lg);
          z-index: 5;
        }

        .r2-qc-submitting-dot {
          width: 8px;
          height: 8px;
          background: var(--warning-amber);
          border-radius: 50%;
          animation: r2dotPulse 0.8s ease-in-out infinite;
        }

        @keyframes r2dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }

        @media (max-width: 480px) {
          .r2-qc-header {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}
