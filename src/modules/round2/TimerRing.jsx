import { useState, useEffect, useRef, useId } from 'react';

/**
 * Module 5 — TimerRing (Round 2)
 *
 * The countdown dome: a gold-rimmed half-medallion carrying the seconds
 * left, shaped like the one that rests on the show's question bar (assets
 * and references/question_styling3.png) — a semi-circle whose flat edge
 * sits flush on the top rail of the question panel. Same geometry as
 * round1/TimerRing; only the arc colour differs (amber-first, to match the
 * hot seat's accent) and the pause handling accumulates paused time instead
 * of just freezing the repaint.
 *
 * R6 — client-side countdown: counts down from `startedAtMs`, the local
 * timestamp taken when this client rendered the question. See round1/TimerRing.
 *
 * R9 — `isPaused` is a real freeze, not just a stopped repaint: time spent
 * paused is accumulated and subtracted from the elapsed clock, so the host
 * locking an answer in mid-question holds the numeral where it stood and a
 * resume picks up from there instead of jumping to wall-clock time.
 */

// Dome geometry, in the 120x58 viewBox below. The coin's centre sits on the
// flat edge, at the very bottom of the box, so only the top half of each
// circle is ever drawn and nothing hangs past the panel it rests on.
const DOME_CX = 60;
const DOME_CY = 56.5;
const BEZEL_RADIUS = 55;
const FACE_RADIUS = 44;
const RING_RADIUS = 48.5;
// Half a circumference: the arc spans the dome from left rim to right rim.
const RING_ARC_LENGTH = Math.PI * RING_RADIUS;

/** Top-half arc of radius r, swept left rim → right rim. */
const domeArc = (r) =>
  `M ${DOME_CX - r} ${DOME_CY} A ${r} ${r} 0 0 1 ${DOME_CX + r} ${DOME_CY}`;

export default function TimerRing({
  startedAtMs,
  durationMs = 10000,
  onTimeUp,
  isPaused = false,
}) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const rafRef = useRef(null);
  const hasCalledTimeUp = useRef(false);
  // Total time this countdown has spent paused, and when the current pause
  // began (null while running).
  const pausedTotalRef = useRef(0);
  const pausedAtRef = useRef(null);
  const onTimeUpRef = useRef(onTimeUp);
  // useId() embeds colons; strip them so the ids stay safe to reference.
  const gradId = useId().replace(/:/g, '');

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    hasCalledTimeUp.current = false;
    pausedTotalRef.current = 0;
    pausedAtRef.current = null;
    setRemainingMs(durationMs);
  }, [startedAtMs, durationMs]);

  useEffect(() => {
    if (isPaused) {
      // Start the clock on the pause itself, so the frozen numeral is not
      // paid for out of the answer window when the countdown resumes.
      if (pausedAtRef.current === null) pausedAtRef.current = Date.now();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    if (pausedAtRef.current !== null) {
      pausedTotalRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }

    // R6 - the anchor is a local timestamp handed down by the engine (the
    // moment this client rendered the question), never the server stamp.
    const startedAt = startedAtMs || Date.now();

    const tick = () => {
      const elapsed = Date.now() - startedAt - pausedTotalRef.current;
      const remaining = Math.max(0, durationMs - elapsed);
      setRemainingMs(remaining);

      if (remaining <= 0 && !hasCalledTimeUp.current) {
        hasCalledTimeUp.current = true;
        onTimeUpRef.current?.();
        return;
      }

      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [startedAtMs, durationMs, isPaused]);

  const fraction = Math.max(0, remainingMs / durationMs);
  const dashOffset = RING_ARC_LENGTH * (1 - fraction);
  const seconds = Math.ceil(remainingMs / 1000);

  // Hot seat runs amber rather than gold, then deepens to red
  const getTimerColor = () => {
    if (fraction > 0.5) return '#E8871E';
    if (fraction > 0.25) return '#F57C00';
    return '#E5484D';
  };

  const timerColor = getTimerColor();
  const isUrgent = fraction <= 0.25;

  return (
    <div className="timer-card timer-card--dome">
      <div className="timer-ring-wrap timer-ring-wrap--dome">
        <svg viewBox="0 0 120 58" aria-hidden="true">
          <defs>
            <linearGradient id={`${gradId}-rim`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F7E7A0" />
              <stop offset="50%" stopColor="#F2B705" />
              <stop offset="100%" stopColor="#A9822F" />
            </linearGradient>
            <radialGradient id={`${gradId}-face`} cx="50%" cy="8%" r="105%">
              <stop offset="0%" stopColor="#1d2f7d" />
              <stop offset="60%" stopColor="#12205e" />
              <stop offset="100%" stopColor="#070f33" />
            </radialGradient>
          </defs>

          {/* Outer bezel */}
          <path
            d={domeArc(BEZEL_RADIUS)}
            fill="none"
            stroke={`url(#${gradId}-rim)`}
            strokeWidth="2.5"
          />

          {/* Track the arc drains along */}
          <path
            d={domeArc(RING_RADIUS)}
            fill="none"
            stroke="rgba(4,10,36,0.9)"
            strokeWidth="7"
          />

          {/* Remaining time */}
          <path
            d={domeArc(RING_RADIUS)}
            fill="none"
            stroke={timerColor}
            strokeWidth="7"
            strokeDasharray={RING_ARC_LENGTH}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke 0.3s ease' }}
          />

          {/* Face the numeral is stamped on */}
          <path d={`${domeArc(FACE_RADIUS)} Z`} fill={`url(#${gradId}-face)`} />
          <path
            d={`${domeArc(FACE_RADIUS)} Z`}
            fill="none"
            stroke="rgba(0,0,0,0.45)"
            strokeWidth="1"
          />

          {/* Gold rail along the flat edge, where the dome meets the panel */}
          <path
            d={`M ${DOME_CX - BEZEL_RADIUS} ${DOME_CY} H ${DOME_CX + BEZEL_RADIUS}`}
            stroke={`url(#${gradId}-rim)`}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        <span className={`timer-center-text ${isUrgent ? 'timer-center-text--urgent' : ''}`}>
          {seconds}
        </span>
      </div>
      {remainingMs <= 0 ? (
        <span className="timer-caption">Time&rsquo;s up</span>
      ) : isPaused ? (
        <span className="timer-caption">Paused</span>
      ) : null}
    </div>
  );
}
