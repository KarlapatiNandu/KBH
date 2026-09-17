/**
 * Module 5 — QuestionCard (Round 2)
 *
 * Renders one question in the classic "hot seat" layout: a wide hexagonal
 * question bar with a rail running through it, and a 2×2 grid of hexagonal
 * option bars beneath (see assets and references/question_styling.png).
 *
 * R7 — the contestant never picks on this screen. They say their answer to
 * the host, who locks it in from the admin console; the verdict then lands
 * here through the responses subscription in Round2Engine. The option bars
 * are display-only.
 *
 * Props:
 *   question        — {id, text, options, correct_option, base_points, prize, order_index}
 *   questionNumber  — 1-indexed display number
 *   totalQuestions   — total question count
 *   timeUp          — true once the countdown has ended with no answer locked in
 *   lastResult      — {is_correct, points_awarded, response_time_ms} or null
 *   revealed        — true once the verdict may be shown; until then a
 *                     locked-in option only lights up gold
 *   selectedOption  — the index the host locked in (or null)
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  timeUp,
  lastResult,
  revealed = false,
  selectedOption,
}) {
  // The lock-in shows immediately; the verdict waits for the reveal.
  const showVerdict = revealed && lastResult !== null;

  // Derive hex styling based on state
  const getHexClass = (index) => {
    const classes = ['r2-hex', 'r2-hex--option'];

    if (selectedOption === null) {
      return classes.join(' ');
    }

    if (showVerdict) {
      if (index === question.correct_option) {
        classes.push('r2-hex--correct');
      } else if (index === selectedOption && !lastResult.is_correct) {
        classes.push('r2-hex--wrong');
      } else {
        classes.push('r2-hex--faded');
      }
    } else if (index === selectedOption) {
      classes.push('r2-hex--selected');
    } else {
      classes.push('r2-hex--dimmed');
    }

    return classes.join(' ');
  };

  return (
    <div className="r2-qc-card">
      {/* Meta row */}
      <div className="r2-qc-header">
        <span className="r2-q-badge">{questionNumber}</span>
        <span className="r2-qc-counter">
          Question {questionNumber} of {totalQuestions}
        </span>
        <span className="r2-qc-points">{question.base_points} pts</span>
      </div>

      {/* Prize for this question (R8) — the gold money bar with its rupee
          coin, as it sits above the question on the show
          (assets and references/question_styling2.png) */}
      {question.prize && (
        <div className="r2-prize-row">
          <div className="r2-prize">
            <div className="r2-hex r2-hex--prize">
              <span className="r2-hex-inner">
                <span className="r2-prize-value">{question.prize}</span>
              </span>
            </div>
            <span className="r2-prize-coin" aria-hidden="true">
              <svg viewBox="0 0 56 56">
                <defs>
                  <linearGradient id="r2CoinRim" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F7E7A0" />
                    <stop offset="50%" stopColor="#F2B705" />
                    <stop offset="100%" stopColor="#A9822F" />
                  </linearGradient>
                  <radialGradient id="r2CoinFace" cx="50%" cy="20%" r="85%">
                    <stop offset="0%" stopColor="#1d2f7d" />
                    <stop offset="65%" stopColor="#12205e" />
                    <stop offset="100%" stopColor="#070f33" />
                  </radialGradient>
                </defs>
                <circle cx="28" cy="28" r="26" fill="url(#r2CoinFace)" stroke="url(#r2CoinRim)" strokeWidth="3" />
                <circle cx="28" cy="28" r="20" fill="none" stroke="url(#r2CoinRim)" strokeWidth="1.5" opacity="0.7" />
                <text
                  x="28"
                  y="29"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="'Poppins', sans-serif"
                  fontSize="24"
                  fontWeight="700"
                  fill="url(#r2CoinRim)"
                >
                  ₹
                </text>
              </svg>
            </span>
          </div>
        </div>
      )}

      {/* Question bar */}
      <div className="r2-rail r2-rail--question">
        <div className="r2-hex r2-hex--question">
          <div className="r2-hex-inner">
            <p className="r2-q-text">{question.text}</p>
          </div>
        </div>
      </div>

      {/* Options — two rows of two, each row sharing one rail */}
      <div className="r2-options-grid">
        {[0, 1].map((row) => (
          <div className="r2-rail r2-rail--options" key={row}>
            {question.options.slice(row * 2, row * 2 + 2).map((option, i) => {
              const index = row * 2 + i;
              return (
                <div className="r2-hex-slot" key={index}>
                  <div className={getHexClass(index)}>
                    <span className="r2-hex-inner">
                      <span className="r2-hex-label">
                        <span className="r2-pill-num">{OPTION_LABELS[index]}:</span>
                        <span className="r2-qc-option-text">{option}</span>
                      </span>
                      {/* Feedback icon */}
                      {showVerdict && index === question.correct_option && (
                        <span className="r2-qc-feedback-icon">✓</span>
                      )}
                      {showVerdict && index === selectedOption && !lastResult.is_correct && index !== question.correct_option && (
                        <span className="r2-qc-feedback-icon">✗</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Host-controlled: what the contestant should do now */}
      {!showVerdict && (
        <div className={`r2-qc-hint ${timeUp ? 'r2-qc-hint--timeup' : ''} ${selectedOption !== null ? 'r2-qc-hint--locked' : ''}`}>
          {selectedOption !== null ? (
            <>
              <span className="r2-qc-hint-icon">🔒</span>
              <span>
                <strong>{OPTION_LABELS[selectedOption]}</strong> is locked in — hold tight for the answer
              </span>
            </>
          ) : timeUp ? (
            <>
              <span className="r2-qc-hint-icon">⏱</span>
              <span>Time&rsquo;s up — waiting for the host</span>
            </>
          ) : (
            <>
              <span className="r2-qc-hint-icon">🎙</span>
              <span>Say your answer out loud — the host will lock it in for you</span>
            </>
          )}
        </div>
      )}

      {/* Result feedback */}
      {showVerdict && (
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

      <style>{`
        .r2-qc-card {
          --r2-hex-cut: 28px;   /* horizontal depth of the pointed ends */
          --r2-hex-border: 2px;
          --r2-hex-clip: polygon(
            var(--r2-hex-cut) 0,
            calc(100% - var(--r2-hex-cut)) 0,
            100% 50%,
            calc(100% - var(--r2-hex-cut)) 100%,
            var(--r2-hex-cut) 100%,
            0 50%
          );
          position: relative;
          padding: var(--space-md) 0 var(--space-lg);
        }

        /* ── Meta row ─────────────────────────────────────────── */
        .r2-qc-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          margin-bottom: var(--space-lg);
          padding: 0 var(--space-md);
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

        /* ── Prize ────────────────────────────────────────────── */
        /* Gold money bar with the rupee coin riding its right tip, sitting
           above the question exactly as it does on the show. */
        .r2-prize-row {
          display: flex;
          justify-content: flex-end;
          padding: 0 var(--space-md);
          margin: calc(-1 * var(--space-sm)) 0 var(--space-md);
        }

        .r2-prize {
          position: relative;
          display: flex;
          align-items: center;
          padding-right: 28px;
        }

        .r2-hex--prize {
          width: auto;
        }

        .r2-hex--prize .r2-hex-inner {
          padding: 8px calc(var(--r2-hex-cut) + 18px);
          min-height: 48px;
          min-width: 180px;
        }

        .r2-prize-value {
          font-family: 'Poppins', sans-serif;
          font-size: 26px;
          font-weight: 700;
          line-height: 1;
          letter-spacing: 0.01em;
          white-space: nowrap;
          color: var(--cloud-white);
          text-shadow: 0 1px 2px rgba(0,0,0,0.6), 0 0 18px rgba(242,183,5,0.35);
        }

        .r2-prize-coin {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 56px;
          height: 56px;
          z-index: 2;
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));
        }

        .r2-prize-coin svg {
          display: block;
          width: 100%;
          height: 100%;
        }

        /* ── Rail: the gold line each row of hexes sits on ────── */
        .r2-rail {
          position: relative;
          display: grid;
          align-items: center;
          padding: 0 var(--space-md);
        }

        .r2-rail::before {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 2px;
          transform: translateY(-50%);
          background: linear-gradient(
            90deg,
            var(--antique-gold),
            var(--champagne-gold) 50%,
            var(--antique-gold)
          );
          box-shadow: 0 0 6px rgba(242,183,5,0.35);
          pointer-events: none;
        }

        .r2-rail--question {
          grid-template-columns: 1fr;
          margin-bottom: var(--space-lg);
        }

        .r2-rail--options {
          grid-template-columns: 1fr 1fr;
          column-gap: var(--space-xl);
        }

        .r2-options-grid {
          display: grid;
          row-gap: var(--space-md);
        }

        /* Slot: per-option rail, only used when options stack on mobile */
        .r2-hex-slot {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 0;
        }

        .r2-hex-slot::before {
          content: '';
          display: none;
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 2px;
          transform: translateY(-50%);
          background: linear-gradient(
            90deg,
            var(--antique-gold),
            var(--champagne-gold) 50%,
            var(--antique-gold)
          );
          box-shadow: 0 0 6px rgba(242,183,5,0.35);
          pointer-events: none;
        }

        /* ── Hex bar: gold shell clipped to a hexagon ─────────── */
        .r2-hex {
          position: relative;
          z-index: 1;
          width: 100%;
          padding: var(--r2-hex-border);
          clip-path: var(--r2-hex-clip);
          background: linear-gradient(
            180deg,
            var(--champagne-gold) 0%,
            var(--spotlight-gold) 45%,
            var(--antique-gold) 100%
          );
          border: 0;
          margin: 0;
          font: inherit;
          color: var(--cloud-white);
          text-align: center;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35));
        }

        /* Inner face: the midnight fill inside the gold shell */
        .r2-hex-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 100%;
          clip-path: var(--r2-hex-clip);
          background:
            radial-gradient(ellipse at 50% 0%, rgba(52,24,104,0.9) 0%, transparent 65%),
            linear-gradient(180deg, #14205c 0%, var(--deep-midnight) 55%, #060c2c 100%);
          transition: background 0.25s ease, color 0.25s ease;
        }

        /* Question bar */
        .r2-hex--question .r2-hex-inner {
          padding: 18px calc(var(--r2-hex-cut) + 16px);
          min-height: 84px;
        }

        .r2-q-text {
          font-family: 'Poppins', sans-serif;
          font-size: 22px;
          font-weight: 600;
          line-height: 1.35;
          color: var(--cloud-white);
          margin: 0;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        /* Option bars — display-only; the host picks (R7) */
        .r2-hex--option .r2-hex-inner {
          padding: 12px calc(var(--r2-hex-cut) + 12px);
          min-height: 56px;
          gap: var(--space-sm);
        }

        .r2-hex-label {
          display: inline-flex;
          align-items: baseline;
          gap: 10px;
          min-width: 0;
        }

        .r2-pill-num {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 18px;
          color: var(--spotlight-gold);
          flex-shrink: 0;
          transition: color 0.25s ease;
        }

        .r2-qc-option-text {
          font-family: 'Inter', sans-serif;
          font-size: 17px;
          font-weight: 600;
          line-height: 1.3;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          overflow-wrap: anywhere;
        }

        /* Locked in by the host, verdict pending — the gold highlight, lit
           the moment the lock-in lands and held until the reveal. */
        .r2-hex--selected {
          animation: r2LockedGlow 1.6s ease-in-out infinite;
        }

        .r2-hex--selected .r2-hex-inner {
          background: linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 55%, var(--amber-glow) 100%);
          color: var(--deep-midnight);
        }

        @keyframes r2LockedGlow {
          0%, 100% { filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35)) drop-shadow(0 0 6px rgba(242,183,5,0.45)); }
          50%      { filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35)) drop-shadow(0 0 18px rgba(242,183,5,0.85)); }
        }

        /* The options not locked in, while the verdict is still pending */
        .r2-hex--dimmed .r2-hex-inner {
          background: linear-gradient(180deg, #0e1745 0%, #0a1238 100%);
        }

        .r2-hex--dimmed .r2-pill-num {
          color: rgba(242,183,5,0.5);
        }

        .r2-hex--dimmed .r2-qc-option-text {
          color: rgba(245,241,230,0.55);
        }

        .r2-hex--selected .r2-pill-num {
          color: var(--deep-midnight);
        }

        .r2-hex--selected .r2-qc-option-text {
          text-shadow: none;
        }

        /* Feedback states */
        .r2-hex--correct .r2-hex-inner {
          background: linear-gradient(180deg, #5fd39a 0%, var(--success-green) 100%);
          color: var(--deep-midnight);
        }

        .r2-hex--correct .r2-pill-num {
          color: var(--deep-midnight);
        }

        .r2-hex--correct .r2-qc-option-text {
          text-shadow: none;
        }

        .r2-hex--wrong .r2-hex-inner {
          background: linear-gradient(180deg, #f06a6e 0%, var(--danger-red) 100%);
          color: #fff;
        }

        .r2-hex--wrong .r2-pill-num {
          color: #fff;
        }

        /* Faded: dim the colours rather than the element, so the rail
           behind the bar does not show through */
        .r2-hex--faded {
          background: linear-gradient(180deg, rgba(169,130,47,0.55) 0%, rgba(169,130,47,0.35) 100%);
          filter: none;
        }

        .r2-hex--faded .r2-hex-inner {
          background: linear-gradient(180deg, #0e1745 0%, #0a1238 100%);
        }

        .r2-hex--faded .r2-pill-num {
          color: rgba(242,183,5,0.35);
        }

        .r2-hex--faded .r2-qc-option-text {
          color: rgba(245,241,230,0.35);
          text-shadow: none;
        }

        .r2-qc-feedback-icon {
          flex-shrink: 0;
          font-weight: 700;
          font-size: 18px;
        }

        /* ── Result bar ───────────────────────────────────────── */
        .r2-qc-result {
          display: flex;
          align-items: center;
          gap: var(--space-md);
          margin: var(--space-lg) var(--space-md) 0;
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

        /* ── Hint ─────────────────────────────────────────────── */
        .r2-qc-hint {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-sm);
          margin: var(--space-lg) var(--space-md) 0;
          padding: 12px 18px;
          border-radius: var(--radius-md);
          border: 1px dashed rgba(242,183,5,0.35);
          background: rgba(242,183,5,0.06);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: var(--pale-gold);
          text-align: center;
        }

        .r2-qc-hint--timeup {
          border-color: rgba(232,135,30,0.5);
          color: var(--warning-amber);
        }

        .r2-qc-hint--locked {
          border-style: solid;
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.12);
          color: var(--champagne-gold);
        }

        .r2-qc-hint--locked strong {
          color: var(--spotlight-gold);
        }

        .r2-qc-hint-icon {
          font-size: 18px;
          flex-shrink: 0;
        }

        /* ── Responsive ───────────────────────────────────────── */
        @media (max-width: 640px) {
          .r2-qc-card {
            --r2-hex-cut: 20px;
          }

          /* Stack options one per row, each on its own rail */
          .r2-rail--options {
            grid-template-columns: 1fr;
            row-gap: var(--space-md);
            padding: 0;
          }

          .r2-rail--options::before {
            display: none;
          }

          .r2-hex-slot {
            padding: 0 var(--space-md);
          }

          .r2-hex-slot::before {
            display: block;
          }

          .r2-q-text {
            font-size: 18px;
          }

          .r2-prize-row {
            justify-content: center;
          }

          .r2-prize-value {
            font-size: 21px;
          }

          .r2-hex--prize .r2-hex-inner {
            min-width: 140px;
            min-height: 42px;
          }

          .r2-prize-coin {
            width: 46px;
            height: 46px;
          }

          .r2-prize {
            padding-right: 23px;
          }

          .r2-qc-option-text {
            font-size: 15px;
          }

          .r2-pill-num {
            font-size: 16px;
          }

          .r2-qc-header {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}
