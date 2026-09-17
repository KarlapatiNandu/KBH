import { useState, useEffect, useRef, useId } from 'react';

/**
 * Module 5 — TimerRing (Round 2)
 *
 * The same gold countdown coin the Fastest Finger round uses (shaped after
 * assets and references/question_styling3.png) — shared `.timer-*` styles
 * live in modules/shared/styles.css. Only the arc colour differs: the hot
 * seat runs amber-first to match the round's accent.
 *
 * R6 — client-side countdown: counts down from `startedAtMs`, the local
 * timestamp taken when this client rendered the question. See round1/TimerRing.
 */

const RING_RADIUS = 49;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function TimerRing({
  startedAtMs,
  durationMs = 10000,
  onTimeUp,
  isPaused = false,
}) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const rafRef = useRef(null);
  const hasCalledTimeUp = useRef(false);
  const onTimeUpRef = useRef(onTimeUp);
  // useId() embeds colons; strip them so the ids stay safe to reference.
  const gradId = useId().replace(/:/g, '');

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    hasCalledTimeUp.current = false;
    setRemainingMs(durationMs);
  }, [startedAtMs, durationMs]);

  useEffect(() => {
    if (isPaused) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    // R6 - the anchor is a local timestamp handed down by the engine (the
    // moment this client rendered the question), never the server stamp.
    const startedAt = startedAtMs || Date.now();

    const tick = () => {
      const elapsed = Date.now() - startedAt;
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
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);
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
    <div className="timer-card">
      <div className="timer-ring-wrap">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id={`${gradId}-rim`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F7E7A0" />
              <stop offset="50%" stopColor="#F2B705" />
              <stop offset="100%" stopColor="#A9822F" />
            </linearGradient>
            <radialGradient id={`${gradId}-face`} cx="50%" cy="18%" r="85%">
              <stop offset="0%" stopColor="#1d2f7d" />
              <stop offset="60%" stopColor="#12205e" />
              <stop offset="100%" stopColor="#070f33" />
            </radialGradient>
          </defs>

          {/* Outer bezel */}
          <circle cx="60" cy="60" r="56" fill="none" stroke={`url(#${gradId}-rim)`} strokeWidth="2.5" />

          {/* Track the arc drains along */}
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(4,10,36,0.9)"
            strokeWidth="8"
          />

          {/* Remaining time */}
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke={timerColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 60 60)"
            style={{ transition: 'stroke 0.3s ease' }}
          />

          {/* Face the numeral is stamped on */}
          <circle cx="60" cy="60" r="43" fill={`url(#${gradId}-face)`} />
          <circle cx="60" cy="60" r="43" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
        </svg>
        <span className={`timer-center-text ${isUrgent ? 'timer-center-text--urgent' : ''}`}>
          {seconds}
        </span>
      </div>
      {remainingMs <= 0 && <span className="timer-caption">Time&rsquo;s up</span>}
    </div>
  );
}
