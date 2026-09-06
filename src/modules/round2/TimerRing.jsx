import { useState, useEffect, useRef } from 'react';

/**
 * Module 5 — TimerRing (Round 2)
 *
 * Renders an SVG ring countdown timer.
 */

const RING_RADIUS = 78;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function TimerRing({
  questionStartedAt,
  durationMs = 10000,
  onTimeUp,
  isPaused = false,
}) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const rafRef = useRef(null);
  const hasCalledTimeUp = useRef(false);
  const onTimeUpRef = useRef(onTimeUp);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    hasCalledTimeUp.current = false;
    setRemainingMs(durationMs);
  }, [questionStartedAt, durationMs]);

  useEffect(() => {
    if (isPaused) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const startedAt = questionStartedAt ? new Date(questionStartedAt).getTime() : Date.now();

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
  }, [questionStartedAt, durationMs, isPaused]);

  const fraction = Math.max(0, remainingMs / durationMs);
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);
  const seconds = Math.ceil(remainingMs / 1000);

  // For Hot Seat, let's use amber instead of aqua for the main color
  const getTimerColor = () => {
    if (fraction > 0.5) return 'var(--warning-amber)';
    if (fraction > 0.25) return '#f57c00'; // dark orange
    return 'var(--danger-red)';
  };

  const timerColor = getTimerColor();
  const isUrgent = fraction <= 0.25 && remainingMs > 0;

  return (
    <div className="r2-timer-card">
      <div className="r2-timer-ring-wrap">
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle
            cx="90"
            cy="90"
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(245,166,35,0.12)"
            strokeWidth="8"
          />
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
          className={`r2-timer-center-text ${isUrgent ? 'r2-timer-center-text--urgent' : ''}`}
          style={{ color: timerColor }}
        >
          {seconds}
        </span>
      </div>
      <span className="r2-timer-caption">
        {remainingMs <= 0 ? "Time's up!" : 'Seconds remaining'}
      </span>

      <style>{`
        .r2-timer-card {
          background: rgba(16,43,86,0.6);
          border: 1px solid rgba(245,166,35,0.2);
          border-radius: var(--radius-lg);
          padding: var(--space-xl);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-md);
          box-shadow: var(--shadow-card);
        }
        
        .r2-timer-ring-wrap {
          position: relative;
          width: 180px;
          height: 180px;
        }

        .r2-timer-center-text {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Poppins', sans-serif;
          font-size: 48px;
          font-weight: 700;
        }

        .r2-timer-caption {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--serene-seafoam);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .r2-timer-center-text--urgent {
          animation: r2timerPulse 0.5s ease-in-out infinite;
        }

        @keyframes r2timerPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}
