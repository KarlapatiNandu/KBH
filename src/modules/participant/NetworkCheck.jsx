import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';

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
 * The check runs on every visit to this screen — no per-session skip — so a
 * connection that degrades mid-event is caught the next time through.
 *
 * A failure is not a hard block: a false negative on flaky campus WiFi
 * shouldn't strand a student mid-event. Their only way forward is an explicit,
 * danger-styled bypass — no Retry, because a retry until it passes just hides
 * the verdict the host needs. The row stays red either way.
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

// Latency bands for the live readout. Purely cosmetic — the pass/fail line is
// still MAX_MEDIAN_LATENCY_MS; these just tell the participant how it *feels*.
const LATENCY_BANDS = [
  { max: 150,  label: 'Excellent', bars: 4, tone: 'good' },
  { max: 400,  label: 'Good',      bars: 3, tone: 'good' },
  { max: 900,  label: 'Sluggish',  bars: 2, tone: 'warn' },
  { max: MAX_MEDIAN_LATENCY_MS, label: 'Laggy', bars: 1, tone: 'warn' },
];

function latencyBand(ms) {
  if (ms === null || ms === undefined) return { label: 'Measuring', bars: 0, tone: 'idle' };
  return (
    LATENCY_BANDS.find((b) => ms <= b.max) ||
    { label: 'Unplayable', bars: 0, tone: 'bad' }
  );
}

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
  const [samples, setSamples] = useState([]); // per-probe round trips, null = dropped
  const [result, setResult] = useState(null); // { passed, detail }
  const cancelledRef = useRef(false);

  const runCheck = useCallback(async () => {
    cancelledRef.current = false;
    setSteps({ ping: 'running', realtime: 'pending', verdict: 'pending' });
    setLatency(null);
    setSamples([]);
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
        const ms = Math.round(performance.now() - startedAt);
        latencies.push(ms);
        setSamples((prev) => [...prev, ms]);
        // Show the running median so the number moves while we probe.
        setLatency(median(latencies));
      } catch {
        // A dropped probe is a data point, not a crash — keep going.
        setSamples((prev) => [...prev, null]);
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
  }, [runCheck]);

  const handleBypass = () => {
    onContinue();
  };

  const failed = result && !result.passed;
  const band = latencyBand(latency);

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
                : 'This connection will struggle during a live round.')
            : `Hang tight, ${participant.name || participant.roll_no} — interrogating your WiFi.`}
        </p>

        <div className={`nc-gauge nc-gauge--${band.tone}`}>
          <div className="nc-gauge-main">
            <span className="nc-gauge-value">
              {latency === null ? '—' : latency}
              <span className="nc-gauge-unit">ms</span>
            </span>
            <span className="nc-gauge-meta">
              <span className="nc-gauge-label">{band.label}</span>
              <span className="nc-gauge-caption">median round trip</span>
            </span>
          </div>
          <div className="nc-bars" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={`nc-bar ${n <= band.bars ? 'nc-bar--on' : ''}`} />
            ))}
          </div>
          <ul className="nc-samples">
            {Array.from({ length: PING_COUNT }, (_, i) => {
              const sample = samples[i];
              const state = i >= samples.length ? 'wait' : sample === null ? 'drop' : 'ok';
              return (
                <li key={i} className={`nc-sample nc-sample--${state}`}>
                  {state === 'wait' ? '···' : state === 'drop' ? 'lost' : `${sample} ms`}
                </li>
              );
            })}
          </ul>
        </div>

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
          <div className="nc-bypass">
            <p className="nc-bypass-warn">
              Bypassing does not guarantee your spot. A dropped socket mid-round counts
              as a missed answer — no replays, no do-overs.
            </p>
            <button className="btn btn-danger nc-bypass-btn" onClick={handleBypass}>
              Bypass at your own risk
            </button>
            <p className="nc-note">
              Your host can see this result, so &ldquo;my WiFi died&rdquo; won&rsquo;t be
              breaking news later.
            </p>
          </div>
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

        .nc-gauge {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: var(--space-md);
          padding: 16px 18px;
          margin-bottom: var(--space-md);
          background: linear-gradient(135deg, rgba(52,24,104,0.55), rgba(11,20,64,0.55));
          border: 1px solid rgba(242,183,5,0.18);
          border-radius: var(--radius-lg);
        }

        .nc-gauge--warn { border-color: rgba(232,135,30,0.35); }
        .nc-gauge--bad  { border-color: rgba(229,72,77,0.4); }

        .nc-gauge-main {
          display: flex;
          align-items: baseline;
          gap: 12px;
          min-width: 0;
        }

        .nc-gauge-value {
          font-family: 'Poppins', sans-serif;
          font-size: 34px;
          font-weight: 700;
          line-height: 1;
          color: var(--spotlight-gold);
          font-variant-numeric: tabular-nums;
        }

        .nc-gauge--good .nc-gauge-value { color: var(--success-green); }
        .nc-gauge--warn .nc-gauge-value { color: var(--warning-amber); }
        .nc-gauge--bad  .nc-gauge-value { color: var(--danger-red); }

        .nc-gauge-unit {
          font-size: 14px;
          font-weight: 600;
          margin-left: 4px;
          color: var(--pale-gold);
        }

        .nc-gauge-meta {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .nc-gauge-label {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: var(--cloud-white);
        }

        .nc-gauge-caption {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgba(240, 244, 248, 0.45);
        }

        .nc-bars {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          height: 28px;
        }

        .nc-bar {
          width: 6px;
          border-radius: 2px;
          background: rgba(240, 244, 248, 0.14);
          transition: background 0.3s ease;
        }

        .nc-bar:nth-child(1) { height: 30%; }
        .nc-bar:nth-child(2) { height: 52%; }
        .nc-bar:nth-child(3) { height: 76%; }
        .nc-bar:nth-child(4) { height: 100%; }

        .nc-gauge--good .nc-bar--on { background: var(--success-green); }
        .nc-gauge--warn .nc-bar--on { background: var(--warning-amber); }
        .nc-gauge--bad  .nc-bar--on { background: var(--danger-red); }
        .nc-gauge--idle .nc-bar--on { background: var(--spotlight-gold); }

        .nc-samples {
          grid-column: 1 / -1;
          list-style: none;
          display: flex;
          gap: 6px;
          margin: 0;
          padding: 0;
        }

        .nc-sample {
          flex: 1;
          text-align: center;
          padding: 4px 0;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          color: var(--pale-gold);
          background: rgba(11,20,64,0.5);
          border: 1px solid rgba(242,183,5,0.12);
          border-radius: var(--radius-sm);
        }

        .nc-sample--wait { color: rgba(240, 244, 248, 0.3); }

        .nc-sample--drop {
          color: var(--danger-red);
          border-color: rgba(229,72,77,0.35);
          background: var(--danger-red-soft);
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

        .nc-bypass {
          margin-top: var(--space-lg);
          padding: 16px;
          background: var(--danger-red-soft);
          border: 1px solid rgba(229, 72, 77, 0.35);
          border-radius: var(--radius-lg);
        }

        .nc-bypass-warn {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          line-height: 1.55;
          color: var(--cloud-white);
          margin-bottom: var(--space-md);
        }

        .nc-bypass-btn {
          width: 100%;
          font-weight: 600;
          letter-spacing: 0.01em;
        }

        .nc-note { margin-top: var(--space-sm); }

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
