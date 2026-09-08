import { useState, useEffect, useRef } from 'react';

/**
 * Module 4 — TimerRing
 *
 * Renders an SVG ring countdown timer.
 *
 * R6 — the countdown is fully client-side. It counts down from `startedAtMs`,
 * a local timestamp taken when this client rendered the question, so every
 * participant gets the full duration regardless of how long the realtime push
 * took to arrive. The engine measures the submitted response time from the
 * same anchor; the server clamps it to the question duration.
 *
 * Props:
 *   startedAtMs  — local Date.now() anchor for the current question
 *   durationMs   — total question duration (from round_state.question_duration_ms)
 *   onTimeUp()   — called once when the countdown reaches zero
 *   isPaused     — if true, freezes the ring (transitions / manual-mode hold)
 */

const RING_RADIUS = 78;
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

  // Keep callback ref fresh without re-triggering effect
  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  // Reset when the question changes
  useEffect(() => {
    hasCalledTimeUp.current = false;
    setRemainingMs(durationMs);
  }, [startedAtMs, durationMs]);

  // Animation loop
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
        return; // Stop the loop
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

  // Visual calculations
  const fraction = Math.max(0, remainingMs / durationMs);
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);
  const seconds = Math.ceil(remainingMs / 1000);

  // Color transitions: green → amber → red
  const getTimerColor = () => {
    if (fraction > 0.5) return 'var(--ocean-aqua)';
    if (fraction > 0.25) return 'var(--warning-amber)';
    return 'var(--danger-red)';
  };

  const timerColor = getTimerColor();
  const isUrgent = fraction <= 0.25 && remainingMs > 0;

  return (
    <div className="timer-card">
      <div className="timer-ring-wrap">
        <svg width="180" height="180" viewBox="0 0 180 180">
          {/* Background ring */}
          <circle
            cx="90"
            cy="90"
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(36,184,175,0.12)"
            strokeWidth="8"
          />
          {/* Active ring */}
          <circle
            cx="90"
            cy="90"
            r={RING_RADIUS}
            fill="none"
            stroke={timerColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 90 90)"
            style={{ transition: 'stroke 0.3s ease' }}
          />
        </svg>
        <span
          className={`timer-center-text ${isUrgent ? 'timer-center-text--urgent' : ''}`}
          style={{ color: timerColor }}
        >
          {seconds}
        </span>
      </div>
      <span className="timer-caption">
        {remainingMs <= 0 ? "Time's up!" : 'Seconds remaining'}
      </span>

      <style>{`
        .timer-center-text--urgent {
          animation: timerPulse 0.5s ease-in-out infinite;
        }

        @keyframes timerPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}
