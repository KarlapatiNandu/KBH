import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { markNetworkCheckComplete } from './storage';

/**
 * R2 — Automatic network check
 *
 * Runs once, immediately after a participant logs in, before they can
 * reach a round. Three probes:
 *
 *   1. Latency     — 3 sequential `network_ping()` round trips, median taken.
 *   2. Realtime    — a throwaway Realtime channel must reach SUBSCRIBED.
 *                    The whole quiz is driven by realtime round_state pushes,
 *                    so a client that cannot hold a socket cannot play no
 *                    matter how fast its HTTP is.
 *   3. Reliability — at least 2 of the 3 pings must come back at all.
 *
 * The verdict is written to `participants.network_status` through the
 * `record_network_check` RPC. Failures render the participant's name in red
 * in the admin Participants list.
 *
 * A failure is not a hard block: a false negative on flaky campus WiFi
 * shouldn't strand a student mid-event. They get Retry (primary) and
 * Continue anyway (secondary); the row stays red either way.
 *
 * Props:
 *   participant — { participant_id, roll_no, name }
 *   onPass()    — check passed; caller sends them to Round 1
 *   onContinue()— failed but continuing anyway; caller sends them home
 */

const PING_COUNT = 3;
const PING_TIMEOUT_MS = 6000;
const REALTIME_TIMEOUT_MS = 8000;
const MAX_MEDIAN_LATENCY_MS = 2000;
const MIN_SUCCESSFUL_PINGS = 2;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

export default function NetworkCheck({ participant, onPass, onContinue }) {
  const [steps, setSteps] = useState({
    ping: 'running',      // running | pass | fail
    realtime: 'pending',
    verdict: 'pending',
  });
  const [latency, setLatency] = useState(null);
  const [result, setResult] = useState(null); // { passed, detail }
  const [runId, setRunId] = useState(0);
  const cancelledRef = useRef(false);

  const runCheck = useCallback(async () => {
    cancelledRef.current = false;
    setSteps({ ping: 'running', realtime: 'pending', verdict: 'pending' });
    setLatency(null);
    setResult(null);

    const failures = [];

    // ─── Probe 1 + 3: latency and reliability ───────────────
    const latencies = [];
    for (let i = 0; i < PING_COUNT; i++) {
      const startedAt = performance.now();
      try {
        const { error } = await withTimeout(
          supabase.rpc('network_ping'),
          PING_TIMEOUT_MS,
          'Ping'
        );
        if (error) throw new Error(error.message);
        latencies.push(Math.round(performance.now() - startedAt));
      } catch {
        // A dropped probe is a data point, not a crash — keep going.
      }
    }

    if (cancelledRef.current) return;

    const medianLatency = median(latencies);
    setLatency(medianLatency);

    const enoughPings = latencies.length >= MIN_SUCCESSFUL_PINGS;
    const fastEnough = medianLatency !== null && medianLatency <= MAX_MEDIAN_LATENCY_MS;

    if (!enoughPings) {
      failures.push(`only ${latencies.length}/${PING_COUNT} server pings returned`);
    } else if (!fastEnough) {
      failures.push(`slow connection (${medianLatency} ms median)`);
    }

    setSteps((s) => ({
      ...s,
      ping: enoughPings && fastEnough ? 'pass' : 'fail',
      realtime: 'running',
    }));

    // ─── Probe 2: realtime socket ───────────────────────────
    let realtimeOk = false;
    const channel = supabase.channel(`netcheck-${participant.participant_id}-${Date.now()}`);

    try {
      realtimeOk = await withTimeout(
        new Promise((resolve) => {
          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') resolve(true);
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(false);
          });
        }),
        REALTIME_TIMEOUT_MS,
        'Realtime'
      );
    } catch {
      realtimeOk = false;
    } finally {
      supabase.removeChannel(channel);
    }

    if (cancelledRef.current) return;

    if (!realtimeOk) failures.push('live updates could not connect');

    setSteps((s) => ({
      ...s,
      realtime: realtimeOk ? 'pass' : 'fail',
      verdict: 'running',
    }));

    // ─── Verdict ────────────────────────────────────────────
    const passed = enoughPings && fastEnough && realtimeOk;
    const detail = passed
      ? `median ${medianLatency} ms, realtime OK`
      : failures.join('; ');

    try {
      await supabase.rpc('record_network_check', {
        p_participant_id: participant.participant_id,
        p_passed: passed,
        p_latency_ms: medianLatency,
        p_detail: detail,
      });
    } catch {
      // If we can't even record the verdict the connection is clearly bad,
      // but the local verdict still drives what the participant sees.
    }

    if (cancelledRef.current) return;

    setSteps((s) => ({ ...s, verdict: passed ? 'pass' : 'fail' }));
    setResult({ passed, detail });

    if (passed) {
      markNetworkCheckComplete(participant.participant_id);
      setTimeout(() => {
        if (!cancelledRef.current) onPass();
      }, 900);
    }
  }, [participant.participant_id, onPass]);

  useEffect(() => {
    runCheck();
    return () => {
      cancelledRef.current = true;
    };
  }, [runCheck, runId]);

  const handleContinueAnyway = () => {
    markNetworkCheckComplete(participant.participant_id);
    onContinue();
  };

  const failed = result && !result.passed;

  return (
    <div className="nc-screen">
      <div className={`nc-card card card--solid ${failed ? 'nc-card--failed' : ''}`}>
        <h2 className="nc-title">
          {result
            ? (result.passed ? 'Connection ready' : 'Connection problem')
            : 'Checking your connection'}
        </h2>
        <p className="nc-sub">
          {result
            ? (result.passed
                ? 'Taking you to Round 1…'
                : 'Your device may struggle during the live round.')
            : `Hang tight, ${participant.name || participant.roll_no} — interrogating your WiFi.`}
        </p>

        <ul className="nc-steps">
          <CheckStep
            state={steps.ping}
            label="Server response"
            detail={latency !== null ? `${latency} ms median` : 'measuring…'}
          />
          <CheckStep
            state={steps.realtime}
            label="Live updates"
            detail="realtime channel"
          />
          <CheckStep
            state={steps.verdict}
            label="Ready to play"
            detail={result ? result.detail : 'waiting on probes'}
          />
        </ul>

        {failed && (
          <div className="nc-actions">
            <button className="btn btn-primary" onClick={() => setRunId((n) => n + 1)}>
              Retry check
            </button>
            <button className="btn btn-secondary" onClick={handleContinueAnyway}>
              Continue anyway
            </button>
          </div>
        )}

        {failed && (
          <p className="nc-note">
            Your host can see this result and will know your connection is unstable.
          </p>
        )}
      </div>

      <style>{`
        .nc-screen {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-xl);
        }

        .nc-card {
          width: 100%;
          max-width: 460px;
          padding: 36px;
        }

        .nc-card--failed {
          border-color: var(--danger-red);
          box-shadow: 0 0 24px rgba(231, 76, 94, 0.15);
        }

        .nc-title {
          font-family: 'Poppins', sans-serif;
          font-size: 22px;
          font-weight: 700;
          color: var(--cloud-white);
          margin-bottom: var(--space-xs);
        }

        .nc-sub {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--pale-gold);
          margin-bottom: var(--space-lg);
        }

        .nc-steps {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
          margin: 0;
          padding: 0;
        }

        .nc-step {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: rgba(11,20,64, 0.5);
          border: 1px solid rgba(242,183,5,0.12);
          border-radius: var(--radius-md);
        }

        .nc-step--pass { border-color: rgba(74, 188, 132, 0.4); }
        .nc-step--fail { border-color: rgba(231, 76, 94, 0.4); }

        .nc-step-icon {
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          border-radius: 50%;
        }

        .nc-step-icon--pending {
          border: 2px solid rgba(240, 244, 248, 0.2);
        }

        .nc-step-icon--running {
          border: 2px solid transparent;
          border-top-color: var(--spotlight-gold);
          animation: ncSpin 0.7s linear infinite;
        }

        @keyframes ncSpin { to { transform: rotate(360deg); } }

        .nc-step-icon--pass {
          background: var(--success-green-soft);
          color: var(--success-green);
        }

        .nc-step-icon--fail {
          background: var(--danger-red-soft);
          color: var(--danger-red);
        }

        .nc-step-body {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .nc-step-label {
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: 14px;
          color: var(--cloud-white);
        }

        .nc-step-detail {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--pale-gold);
        }

        .nc-actions {
          display: flex;
          gap: var(--space-sm);
          margin-top: var(--space-lg);
        }

        .nc-actions .btn { flex: 1; }

        .nc-note {
          margin-top: var(--space-md);
          font-size: 12px;
          color: rgba(240, 244, 248, 0.45);
          text-align: center;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}


function CheckStep({ state, label, detail }) {
  const glyph = state === 'pass' ? '✓' : state === 'fail' ? '✕' : '';

  return (
    <li className={`nc-step nc-step--${state}`}>
      <span className={`nc-step-icon nc-step-icon--${state}`}>{glyph}</span>
      <span className="nc-step-body">
        <span className="nc-step-label">{label}</span>
        <span className="nc-step-detail">{detail}</span>
      </span>
    </li>
  );
}
