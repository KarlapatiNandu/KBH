import TimerRing from './TimerRing';
import LifelineBar from './LifelineBar';
import LifelineIcon from './LifelineIcon';
import AudiencePoll from './AudiencePoll';
import PriceTag from './PriceTag';
import { lifelineLabel } from './lifelines';

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
 *                     locked-in option only lights up gold. The reveal is
 *                     carried entirely by the option bars turning green/red;
 *                     there is no separate verdict banner.
 *   selectedOption  — the index the host locked in (or null)
 *   timerStartedAtMs, timerDurationMs, onTimeUp, timerPaused
 *                   — passed straight through to the countdown dome, which
 *                     is docked on the question bar rather than floating
 *                     above the card (assets and references/round2_timer.png)
 *
 * R18 — `optionsHidden` is a staged question waiting on the host: only the
 * question is up. The options and the countdown dome are held back (their
 * space is kept) until the host releases them.
 *
 * R10 — lifelines. The rail of four badges under the question bar is
 * LifelineBar (assets and references/Lifeline.png), and whichever lifeline
 * the host has picked rides the crossing point of the option rows as a
 * medallion (assets and references/Chosen_lifeline_display.png). 50:50 is
 * the only one that changes the options themselves: the two indices the host
 * struck come in as `removedOptions` and their bars are emptied out.
 *
 *   lifelineStatuses   — { [key]: 'available' | 'active' | 'used' }, or null
 *                        to leave the rail off the board entirely
 *   activeLifelineKey  — the lifeline live on THIS question, or null. Drives
 *                        the LIVE banner: something is actually running.
 *   chosenLifelineKey  — the lifeline this question belongs to, or null.
 *                        Drives the medallion, and comes up as soon as the
 *                        host picks the lifeline — a beat before it is
 *                        played, which is when the contestant names it. (R12)
 *   lifelineHolding    — true while a lifeline still has the countdown: picked
 *                        and not yet played, playing, or (the poll) still on
 *                        screen. It is what decides whether the banner below
 *                        reads LIVE, PICKED or TIME UP. (R13)
 *   removedOptions     — 0-based indices struck by 50:50 on this question
 *
 * R11 — the Audience Poll now comes back with a result. Once the host ends
 * the poll the room's tally arrives as `pollVotes` and AudiencePoll draws it
 * in the card's top-right corner (assets and references/
 * Audience_pole_Display.png). It sits over the prize bar, which is the only
 * thing in that corner — the prize fades back while the chart is up and
 * comes forward again the moment it goes. The chart stays until the host
 * hides it from the console, which is also what restarts the countdown.
 *
 *   pollVotes          — raw vote counts per option, or null for no chart
 *
 * R14 — the prize bar says what this one question is worth; the ladder
 * behind it says what the run is worth. `onOpenLadder` puts a button
 * beside the prize that opens it (Round2Engine owns the panel itself), and
 * is null when the host has not set a ladder — no button for a panel with
 * nothing in it.
 *
 *   onOpenLadder       — open the prize ladder, or null for no button
 *
 * R15 — and the reveal is where the money lands. The moment the host shows
 * the verdict the whole board fades back, the question bar shades to black
 * behind it, and the price tag for that rung takes the screen: four fifths
 * of its width, centred, green if the answer was right and red if it was
 * wrong (the tag from `assets and references/Price_list_display.png`). The
 * board is still readable underneath — the options keep their green and red
 * — but it stops competing: it says *which* answer, and the tag says what it
 * was worth, which is the thing the room is waiting on.
 *
 *   prizeLabel         — what this rung pays, from the ladder; falls back
 *                        to question.prize
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
  timerStartedAtMs,
  timerDurationMs,
  onTimeUp,
  timerPaused = false,
  lifelineStatuses = null,
  activeLifelineKey = null,
  chosenLifelineKey = null,
  lifelineHolding = false,
  removedOptions = [],
  pollVotes = null,
  onOpenLadder = null,
  prizeLabel = null,
  optionsHidden = false,
}) {
  // The lock-in shows immediately; the verdict waits for the reveal.
  const showVerdict = revealed && lastResult !== null;

  // R15 — the money the reveal is about. The ladder's rung wins over the
  // question's own prize only when the question has none: the bar above has
  // been showing question.prize all the way through, and the tag must not
  // contradict it on the beat it matters.
  const verdictPrize = showVerdict ? (question.prize || prizeLabel) : null;

  // R13 — what the banner under the options is announcing. A lifeline that
  // is actually running reads LIVE; one the host has only picked reads
  // PICKED, because the contestant's countdown has already stopped for it
  // and a frozen clock with nothing on screen to explain it reads as a
  // fault. The odd one out is a call whose own clock has run out while the
  // host has not yet ended the row: the question clock is already back, so
  // the line says so rather than insisting it is paused.
  const bannerKey = activeLifelineKey || (lifelineHolding ? chosenLifelineKey : null);
  const bannerLive = !!activeLifelineKey;

  // 50:50 — the two the host struck off this question. (R10)
  const isStruck = (index) => removedOptions.includes(index);

  // Derive hex styling based on state
  const getHexClass = (index) => {
    const classes = ['r2-hex', 'r2-hex--option'];

    // A struck option is out of the running: it keeps its bar (so the grid
    // does not reflow mid-question) but loses its letter and its text, and
    // no later verdict styling applies to it.
    if (isStruck(index)) {
      classes.push('r2-hex--struck');
      return classes.join(' ');
    }

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

  // R11 — the poll chart lands in the same corner as the prize.
  const showPoll = Array.isArray(pollVotes) && pollVotes.length > 0;

  return (
    <>
      <div className={`r2-qc-card ${showPoll ? 'r2-qc-card--poll' : ''} ${verdictPrize ? 'r2-qc-card--verdict' : ''}`}>
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
          (assets and references/question_styling2.png)

          R14 — and the way into the whole ladder, on the same line: what
          this question pays and what the climb pays are the same thought,
          and the contestant reaches for the second one from the first. */}
        {(question.prize || onOpenLadder) && (
          <div className="r2-prize-row">
            {onOpenLadder && (
              <button
                type="button"
                className="r2-ladder-btn"
                onClick={onOpenLadder}
                title="See the whole prize ladder and the lifelines you have left"
              >
                <svg className="r2-ladder-btn-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2 3.5h12M2 8h12M2 12.5h12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                Prize ladder
              </button>
            )}

            {question.prize && (
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
            )}
          </div>
        )}

        {/* R11 — the audience's verdict, once the host has published it. In
          the card's top-right corner on a wide board; in the flow here,
          above the question, once there is no corner left to put it in. */}
        {showPoll && (
          <AudiencePoll
            votes={pollVotes}
            labels={OPTION_LABELS.slice(0, pollVotes.length)}
          />
        )}

        {/* Countdown dome, resting flat on the question bar's top rail */}
        <div className="r2-timer-dock">
          {/* R18 — a staged question has no clock until the host releases the
            options. The dock stays, so the question bar does not jump when
            the dome arrives; the ring mounts fresh on release, which is also
            what starts it from the full time. */}
          {!optionsHidden && (
            <TimerRing
              startedAtMs={timerStartedAtMs}
              durationMs={timerDurationMs}
              onTimeUp={onTimeUp}
              isPaused={timerPaused}
            />
          )}
        </div>

        {/* Question bar

          R15 — on the reveal it goes out: the face shades to black, the
          question fades back behind it, and the price tag takes the middle
          of the board. The bar itself does not move, so nothing on the
          screen below it reflows while the room is looking at the tag. */}
        <div className="r2-rail r2-rail--question">
          <div className={`r2-hex r2-hex--question ${verdictPrize ? 'r2-hex--shaded' : ''}`}>
            <div className="r2-hex-inner">
              <p className="r2-q-text">{question.text}</p>
            </div>
          </div>

        </div>

        {/* Lifelines — the rail of four badges, as on the show (R10). Null
          while the database has no lifeline_state to read, so an un-migrated
          setup shows the board it always did rather than four dead badges. */}
        {lifelineStatuses && <LifelineBar statuses={lifelineStatuses} />}

        {/* Options — two rows of two, each row sharing one rail */}
        <div
          className={`r2-options-grid ${optionsHidden ? 'r2-options-grid--hidden' : ''}`}
          aria-hidden={optionsHidden || undefined}
        >
          {[0, 1].map((row) => (
            <div className="r2-rail r2-rail--options" key={row}>
              {question.options.slice(row * 2, row * 2 + 2).map((option, i) => {
                const index = row * 2 + i;
                const struck = isStruck(index);
                return (
                  <div className="r2-hex-slot" key={index}>
                    <div className={getHexClass(index)}>
                      <span className="r2-hex-inner">
                        {/* A struck option leaves an empty bar behind — the
                          same thing 50:50 does on the show. */}
                        {!struck && (
                          <span className="r2-hex-label">
                            <span className="r2-pill-num">{OPTION_LABELS[index]}:</span>
                            <span className="r2-qc-option-text">{option}</span>
                          </span>
                        )}
                        {/* Feedback icon */}
                        {!struck && showVerdict && index === question.correct_option && (
                          <span className="r2-qc-feedback-icon">✓</span>
                        )}
                        {!struck && showVerdict && index === selectedOption && !lastResult.is_correct && index !== question.correct_option && (
                          <span className="r2-qc-feedback-icon">✗</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* The lifeline this question belongs to rides the crossing point of
            the two option rows (assets and references/
            Chosen_lifeline_display.png). It comes up the moment the host
            picks it, before it is played — see chosenLifelineKey. */}
          {chosenLifelineKey && (
            <span
              className="r2-chosen-lifeline"
              role="img"
              aria-label={`${lifelineLabel(chosenLifelineKey)} chosen`}
              title={`${lifelineLabel(chosenLifelineKey)} chosen`}
            >
              <LifelineIcon lifelineKey={chosenLifelineKey} />
            </span>
          )}
        </div>

        {/* The indicator a lifeline puts on this screen — while it is running,
          and (R13) from the moment it is picked, since that is when the
          countdown stops. For the Audience Poll this is what is up while the
          room votes; the chart replaces it once the host ends the poll (R11).
          The phone lifelines put PhoneOverlay up over the whole board and
          this line sits underneath it. */}


        {/* Host-controlled: what the contestant should do now. Once the clock
          has run out there is nothing to say here, so the hint drops away
          rather than announcing the obvious back at the contestant. */}


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
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-sm);
          padding: 0 var(--space-md);
          margin: calc(-1 * var(--space-sm)) 0 var(--space-md);
        }

        /* ── Prize ladder (R14) ──────────────────────────────── */
        /* The way into the ladder, parked at the far end of the prize
           line. Quiet on purpose: it is a thing to reach for between
           questions, and it must not pull the eye away from the money bar
           it sits next to. */
        .r2-ladder-btn {
          margin-right: auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(242,183,5,0.35);
          background: rgba(11,20,64,0.55);
          color: var(--pale-gold);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
        }

        .r2-ladder-btn:hover {
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.12);
          color: var(--spotlight-gold);
        }

        .r2-ladder-btn-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
        }

        /* The poll chart takes this corner for as long as it is up. The
           prize does not move — the board must not reflow mid-question —
           it just steps back, and comes forward again with the next
           question. (R11) */
        /* R14 — the money bar, not the whole row: the ladder button is at
           the other end of that line and nowhere near the chart's corner,
           so it keeps its weight. The clock is paused while the chart is
           up, which is exactly when a contestant opens the ladder to work
           out whether to walk. */
        .r2-qc-card--poll .r2-prize {
          opacity: 0.18;
        }

        /* Below 720px the chart drops into the flow instead of taking the
           corner (see AudiencePoll's own breakpoint, deliberately the same
           number), so nothing is over the prize and it keeps its weight. */
        @media (max-width: 720px) {
          .r2-qc-card--poll .r2-prize { opacity: 1; }
        }

        .r2-prize {
          position: relative;
          display: flex;
          align-items: center;
          padding-right: 28px;
          transition: opacity 0.5s ease;
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

        /* ── Timer dock ───────────────────────────────────────── */
        /* The dome hangs directly off the question bar, so its flat edge
           reads as part of that bar's top rail — not as a badge floating
           over the card as a whole. */
        .r2-timer-dock {
          position: relative;
          z-index: 3;
          display: flex;
          justify-content: center;
          padding: 0 var(--space-md);
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

        /* ── The reveal (R15) ────────────────────────────────── */
        /* The question goes black under the verdict. It is still there —
           the bar keeps its gold shell and its height, so the board holds
           its shape — but it stops being the thing on screen, which is the
           whole point: what is being read now is the money. */
        .r2-hex--shaded .r2-hex-inner {
          background: linear-gradient(180deg, #0a0a0a 0%, #000 60%, #000 100%);
          transition: background 0.55s ease;
        }

        /* The question goes with it. Left faintly legible it reads as a
           rendering fault — two words poking out either side of the tag —
           so it goes out entirely and the bar is simply black. */
        .r2-hex--shaded .r2-q-text {
          opacity: 0;
          transition: opacity 0.4s ease;
        }

        /* And the board with it. The question, the options, the rail and
           the clock have all done their job by the time the verdict lands;
           holding them at full strength next to the money only splits the
           room's attention. They stay legible — the contestant can still
           see which option went green — they just stop shouting. */
        .r2-qc-card--verdict {
          opacity: 0.22;
          transition: opacity 0.55s ease;
        }

        /* The price tag, over the whole screen at four fifths of its width.
           It comes in a beat after the fade so the two read as one movement
           — the board drops back, then the money arrives — and it takes no
           pointer events, because there is nothing on it to press and the
           board underneath must stay reachable. */
        .r2-verdict-prize {
          position: fixed;
          inset: 0;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          animation: r2TagIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.35s both;
        }

        /* 80% of the screen: the bar stretches to fill it while the type
           and the coin scale on their own, so the tag keeps its proportions
           on a phone and on a projector alike. */
        .r2-verdict-prize .pt {
          width: 80vw;
          --pt-scale: 2.2;
        }

        .r2-verdict-prize .pt-bar {
          flex: 1;
          min-width: 0;
        }

        @keyframes r2TagIn {
          from { opacity: 0; transform: scale(0.5); }
          60%  { opacity: 1; transform: scale(1.06); }
          to   { opacity: 1; transform: scale(1); }
        }

        /* Green when it is theirs, red when it has just gone. The halo is
           what carries that at a glance from the back of a room. */
        .r2-verdict-prize--won {
          filter: drop-shadow(0 0 34px rgba(74,188,132,0.5));
        }

        .r2-verdict-prize--lost {
          filter: drop-shadow(0 0 34px rgba(229,72,77,0.5));
        }

        .r2-sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }

        .r2-rail--options {
          grid-template-columns: 1fr 1fr;
          column-gap: var(--space-xl);
        }

        /* R18 — a staged question's options wait for the host. They hold
           their place so the board does not reflow, and fade in on release. */
        .r2-options-grid--hidden {
          visibility: hidden;
          opacity: 0;
        }

        .r2-options-grid:not(.r2-options-grid--hidden) {
          animation: r2OptionsIn 0.6s ease both;
        }

        @keyframes r2OptionsIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }

        .r2-options-grid {
          position: relative;   /* anchors the chosen-lifeline medallion */
          display: grid;
          row-gap: var(--space-md);
        }

        /* ── 50:50 ───────────────────────────────────────────── */
        /* The bar stays, emptied: the grid must not reflow half-way
           through a question, and the gap is the point. */
        .r2-hex--struck {
          background: linear-gradient(180deg, rgba(169,130,47,0.5) 0%, rgba(169,130,47,0.3) 100%);
          filter: none;
        }

        .r2-hex--struck .r2-hex-inner {
          background: linear-gradient(180deg, #0a1030 0%, #070b24 100%);
        }

        /* ── Chosen lifeline ─────────────────────────────────── */
        /* The badge of the lifeline in play, parked on the crossing point
           of the two option rows. */
        .r2-chosen-lifeline {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 4;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 76px;
          height: 48px;
          border-radius: 50%;
          border: 2.5px solid transparent;
          background:
            linear-gradient(180deg, #14205c 0%, #0a1138 100%) padding-box,
            linear-gradient(180deg, var(--champagne-gold) 0%, var(--spotlight-gold) 45%, var(--antique-gold) 100%) border-box;
          color: var(--spotlight-gold);
          filter: drop-shadow(0 0 14px rgba(242,183,5,0.6));
          animation: r2ChosenIn 0.35s ease;
        }

        .r2-chosen-lifeline .ll-icon {
          width: 52px;
          height: 32px;
        }

        @keyframes r2ChosenIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }

        /* ── Active-lifeline banner ──────────────────────────── */
        .r2-ll-banner {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          margin: var(--space-lg) var(--space-md) 0;
          padding: 10px 14px;
          border-radius: var(--radius-md);
          border: 1px solid var(--spotlight-gold);
          background: rgba(242,183,5,0.1);
        }

        /* Picked but not yet played: the same line, held back a shade. The
           countdown is stopped either way, but nothing is on air yet. (R13) */
        .r2-ll-banner--picked {
          border-color: var(--antique-gold);
          background: rgba(169,130,47,0.12);
        }

        .r2-ll-banner--picked .r2-ll-banner-live {
          color: var(--pale-gold);
          animation: none;
        }

        .r2-ll-banner-badge {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 34px;
          border-radius: 50%;
          border: 2px solid var(--antique-gold);
          background: linear-gradient(180deg, #14205c 0%, #0a1138 100%);
          color: var(--spotlight-gold);
        }

        .r2-ll-banner-badge .ll-icon {
          width: 36px;
          height: 22px;
        }

        .r2-ll-banner-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
          flex: 1;
          min-width: 0;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: var(--pale-gold);
        }

        .r2-ll-banner-text strong {
          font-family: 'Poppins', sans-serif;
          font-size: 14px;
          color: var(--spotlight-gold);
        }

        .r2-ll-banner-live {
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--warning-amber);
          animation: r2LlLive 1.4s ease-in-out infinite;
        }

        @keyframes r2LlLive {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }

        @media (prefers-reduced-motion: reduce) {
          .r2-chosen-lifeline,
          .r2-ll-banner-live { animation: none; }

          /* The tag still has to appear — it just appears rather than
             swooping. */
          .r2-verdict-prize {
            animation: none;
            opacity: 1;
            transform: none;
          }
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

          /* Stacked rows leave no crossing point for the medallion to sit
             on, and it would land on top of an option bar instead. */
          .r2-chosen-lifeline { display: none; }

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

          /* The bar still takes its 80%; only the type and the coin come
             down, so a phone gets the same tag rather than a cropped one.
             (R15) */
          .r2-verdict-prize .pt {
            --pt-scale: 1.1;
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

      {/* The money, over everything. It is out of the card on purpose: the
        card fades back on the reveal, and a tag inside it would fade with
        it — this is the one thing on screen that must not. (R15) */}
      {verdictPrize && (
        <div
          className={`r2-verdict-prize ${lastResult.is_correct ? 'r2-verdict-prize--won' : 'r2-verdict-prize--lost'}`}
          role="status"
          aria-live="polite"
        >
          <span className="r2-sr-only">
            {lastResult.is_correct
              ? `Correct — ${verdictPrize}`
              : `Wrong — ${verdictPrize} lost`}
          </span>
          <PriceTag
            label={verdictPrize}
            tone={lastResult.is_correct ? 'green' : 'red'}
            size="xl"
          />
        </div>
      )}
    </>
  );
}
