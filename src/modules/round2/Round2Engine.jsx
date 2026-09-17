import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import QuestionCard from './QuestionCard';
import TimerRing from './TimerRing';
import Round2Results from './Round2Results';

/**
 * Module 5 — Round2Engine
 *
 * Core orchestrator for the Hot Seat round.
 * Scoped to round = 2 and active_participant_id.
 *
 * R7 — the contestant does not answer on this device. The host locks the
 * answer in from the admin console (host_submit_answer); this engine watches
 * the `responses` table and mirrors that lock-in and its verdict here.
 *
 * R9 — and the host decides when the verdict lands. The lock-in freezes this
 * screen's countdown and lights the chosen option gold; nothing else moves
 * until `responses.revealed_at` is stamped (host_reveal_answer). The timer
 * reaching zero no longer reveals anything — it only matters for a question
 * nobody locked an answer into.
 */

const TRANSITION_DELAY_MS = 2500; // Time between questions to show feedback
const DEFAULT_DURATION_MS = 10000; // Fallback if round_state.question_duration_ms is unset
const LOCK_POLL_MS = 1200;        // How often to look for the host's lock-in / reveal

export default function Round2Engine({ participant }) {
  const navigate = useNavigate();

  const [roundState, setRoundState] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [gamePhase, setGamePhase] = useState('loading'); 
  const [selectedOption, setSelectedOption] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  // The host's lock-in lights the option gold straight away; the verdict is
  // held back until the host reveals it from the console. (R9)
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState(null);

  // R6 - client-side timing. `questionAnchor` is the local wall-clock moment
  // this client actually rendered the live question; both the countdown and
  // the reported response time measure from it.
  const [questionAnchor, setQuestionAnchor] = useState(null);
  const anchorMsRef = useRef(null);
  const anchorKeyRef = useRef(null);
  const advanceTimeoutRef = useRef(null);
  // Signature of the response row as last seen, so repeated polls that find
  // nothing new cost nothing — no state writes, no re-render.
  const responseSigRef = useRef(undefined);

  const answeredQuestionsRef = useRef(new Set());

  // Latest round state / questions for callbacks that must not re-subscribe
  // on every realtime tick.
  const roundStateRef = useRef(null);
  const questionsRef = useRef([]);
  useEffect(() => { roundStateRef.current = roundState; }, [roundState]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  // Load questions
  useEffect(() => {
    async function loadQuestions() {
      const { data, error: fetchError } = await supabase
        .from('questions')
        .select('*')
        .eq('round', 2)
        .order('order_index');

      if (fetchError) {
        setError('Failed to load questions');
        return;
      }

      setQuestions(data || []);
      setQuestionsLoaded(true);
    }

    loadQuestions();
  }, []);

  const checkExistingResponse = useCallback(async (questionId) => {
    if (!questionId || !participant.participant_id) return null;

    const { data } = await supabase
      .from('responses')
      .select('*')
      .eq('participant_id', participant.participant_id)
      .eq('question_id', questionId)
      .maybeSingle();

    return data;
  }, [participant.participant_id]);

  // Subscribe to round_state
  useEffect(() => {
    async function fetchRoundState() {
      const { data } = await supabase
        .from('round_state')
        .select('*')
        .eq('round', 2)
        .single();

      if (data) {
        setRoundState(data);
      }
    }

    fetchRoundState();

    const channel = supabase
      .channel('round2-engine-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_state', filter: 'round=eq.2' },
        (payload) => {
          setRoundState(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // R7 — mirror the host's lock-in. Rather than trusting the realtime
  // payload, any change to `responses` triggers a re-read of this
  // contestant's row for the live question: that covers INSERT (host locked
  // in), DELETE (host cleared on re-serve — DELETE payloads carry only the
  // PK, so they cannot be filtered) and a missed event alike.
  const syncResponse = useCallback(async () => {
    const state = roundStateRef.current;
    if (!state || state.status !== 'active') return;
    const currentQ = questionsRef.current.find(
      (q) => q.order_index === state.current_question_index
    );
    if (!currentQ) return;

    // Remember which serve we are reading for: if the host moves on (or
    // re-serves) while this read is in flight, its result is stale.
    const servedKey = anchorKeyRef.current;

    const existing = await checkExistingResponse(currentQ.id);
    if (anchorKeyRef.current !== servedKey) return;

    // revealed_at is part of the signature: the host revealing an answer is
    // an UPDATE to a row we are already showing, and it must not be
    // swallowed as "nothing new". (R9)
    const sig = existing
      ? `${existing.selected_option}:${existing.is_correct}:${existing.points_awarded}:${existing.response_time_ms}:${existing.revealed_at}`
      : null;
    if (sig === responseSigRef.current) return;
    responseSigRef.current = sig;

    if (existing) {
      answeredQuestionsRef.current.add(currentQ.id);
      setSelectedOption(existing.selected_option);
      const verdict = {
        is_correct: existing.is_correct,
        points_awarded: existing.points_awarded,
        response_time_ms: existing.response_time_ms,
      };
      setLastResult(verdict);
      setHasAnswered(true);
      // Nothing local decides this any more — the host's stamp does, and an
      // un-reveal (host clears and re-locks) walks back with it.
      setRevealed(!!existing.revealed_at);
    } else if (answeredQuestionsRef.current.has(currentQ.id)) {
      // Was locked in, now gone — the host cleared it. Reopen.
      answeredQuestionsRef.current.delete(currentQ.id);
      setSelectedOption(null);
      setLastResult(null);
      setHasAnswered(false);
      setRevealed(false);
    }
  }, [checkExistingResponse]);

  useEffect(() => {
    if (!participant.participant_id) return;

    const channel = supabase
      .channel(`round2-engine-responses-${participant.participant_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'responses' },
        () => syncResponse()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [participant.participant_id, syncResponse]);

  // Polling fallback until the lock-in and its reveal land: realtime delivery to a phone
  // on venue wifi is not something to bet the hot seat on, and one client
  // polling a single indexed row costs nothing. Deliberately *not* gated on
  // gamePhase — the host usually locks the answer in after the countdown has
  // run out, by which point the phase is 'held' (manual mode) or
  // 'transition', and stopping there is what left the contestant's screen
  // frozen on an un-locked question.
  useEffect(() => {
    if (roundState?.status !== 'active') return;
    const id = setInterval(syncResponse, LOCK_POLL_MS);
    return () => clearInterval(id);
  }, [roundState?.status, syncResponse]);

  // ─── Derive game phase from round_state ──────────────────────
  useEffect(() => {
    if (!questionsLoaded || !roundState) {
      setGamePhase('loading');
      return;
    }

    if (roundState.status === 'inactive') {
      setGamePhase('waiting');
      return;
    }

    if (roundState.status === 'completed') {
      setGamePhase('completed');
      return;
    }

    if (roundState.status !== 'active') return;

    // Resolve the live question by order_index - the same key the server
    // matches on. Array position breaks as soon as order_index has a gap, or
    // the host serves questions out of order. (ISSUES 1.4 / R5)
    const currentQ = questions.find(
      (q) => q.order_index === roundState.current_question_index
    );

    if (!currentQ) {
      // The host may be between questions - hold rather than declaring the
      // round over, which would strand everyone on the results screen.
      setGamePhase('active');
      return;
    }

    // A question counts as new when its id OR its serve timestamp changes:
    // the host can re-serve the same question, and that must reset local state.
    const anchorKey = `${currentQ.id}:${roundState.question_started_at}`;
    if (anchorKeyRef.current === anchorKey) return;
    anchorKeyRef.current = anchorKey;

    // R6 - anchor the countdown on the local clock, now, so a slow realtime
    // push does not eat into this participant's answer window.
    const anchoredAt = Date.now();
    anchorMsRef.current = anchoredAt;
    setQuestionAnchor(anchoredAt);

    answeredQuestionsRef.current.delete(currentQ.id);
    responseSigRef.current = undefined;
    setSelectedOption(null);
    setLastResult(null);
    setHasAnswered(false);
    setRevealed(false);
    setGamePhase('active');

    // A response may already exist - page reload, or a re-serve that did not
    // clear responses. Reflect it so the verdict survives a refresh.
    checkExistingResponse(currentQ.id).then((existing) => {
      if (!existing) return;
      answeredQuestionsRef.current.add(currentQ.id);
      responseSigRef.current = `${existing.selected_option}:${existing.is_correct}:${existing.points_awarded}:${existing.response_time_ms}:${existing.revealed_at}`;
      setSelectedOption(existing.selected_option);
      const verdict = {
        is_correct: existing.is_correct,
        points_awarded: existing.points_awarded,
        response_time_ms: existing.response_time_ms,
      };
      setLastResult(verdict);
      setHasAnswered(true);
      // A reload mid-reveal must come back revealed, not replay the hold. (R9)
      setRevealed(!!existing.revealed_at);
    });
  }, [roundState, questionsLoaded, questions, checkExistingResponse]);

  // Once the question is settled — the timer ran out on an unanswered
  // question, or the host revealed the verdict — hand the round on: hold for
  // the host in manual mode, otherwise run the transition and advance. (R5)
  const settleQuestion = useCallback(() => {
    if (!roundStateRef.current || roundStateRef.current.status !== 'active') return;

    if (roundStateRef.current.manual_mode) {
      setGamePhase('held');
      return;
    }

    setGamePhase('transition');

    // Held in a ref so navigating away mid-transition does not fire the RPC
    // from a dead component. (ISSUES 3.9)
    clearTimeout(advanceTimeoutRef.current);
    advanceTimeoutRef.current = setTimeout(async () => {
      try {
        await supabase.rpc('advance_question', { p_round: 2 });
        // The realtime subscription will pick up the state change
      } catch (err) {
        console.error('Advance question error:', err);
      }
    }, TRANSITION_DELAY_MS);
  }, []);

  const handleTimeUp = useCallback(() => {
    if (!roundState || roundState.status !== 'active') return;

    if (!hasAnswered) {
      setHasAnswered(true);
    }

    // R9 — the countdown no longer reveals anything. With an answer locked
    // in the timer is frozen and this never fires; reaching zero therefore
    // only means nobody locked one in, and the question is over.
    settleQuestion();
  }, [roundState, hasAnswered, settleQuestion]);

  // R9 — the host's reveal is what closes a question that was answered.
  useEffect(() => {
    if (!revealed) return;
    settleQuestion();
  }, [revealed, settleQuestion]);

  // Cancel pending timers if we unmount first. (ISSUES 3.9)
  useEffect(() => () => {
    clearTimeout(advanceTimeoutRef.current);
  }, []);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const currentQuestion = roundState
    ? questions.find((q) => q.order_index === roundState.current_question_index) || null
    : null;

  // Position within the round, not the raw order_index - the host can serve
  // out of order and "Question 3 of 5" should still read sensibly.
  const currentQuestionNumber = currentQuestion
    ? questions.findIndex((q) => q.id === currentQuestion.id) + 1
    : 0;

  // Per-question time wins over the round default. (R8)
  const questionDurationMs =
    currentQuestion?.duration_ms ?? roundState?.question_duration_ms ?? DEFAULT_DURATION_MS;

  // R9 — the host has the answer; the clock stops there and stays stopped for
  // this question. Revealing does not restart it, so the countdown can never
  // run out from under an answer that is already in.
  const answerLocked = selectedOption !== null;

  // Render logic

  // If we are not the active participant and the round is active/completed, we shouldn't really be here,
  // but if we are, display a disabled view.
  if (roundState && roundState.status !== 'inactive' && roundState.active_participant_id !== participant.participant_id) {
    return (
      <div className="r2-screen">
        <div className="r2-center">
          <div className="r2-disabled-icon">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
              <rect x="10" y="24" width="36" height="26" rx="5" fill="var(--spotlight-gold)" />
              <path d="M18 24v-6a10 10 0 0 1 20 0v6" stroke="var(--spotlight-gold)" strokeWidth="4" strokeLinecap="round" fill="none" />
              <circle cx="28" cy="35" r="3.5" fill="var(--deep-midnight)" />
              <rect x="26.5" y="36" width="3" height="7" rx="1.5" fill="var(--deep-midnight)" />
            </svg>
          </div>
          <h2 className="r2-waiting-title">Hot Seat in Progress</h2>
          <p className="r2-status-text">Only the selected participant can view these questions.</p>
          <button className="btn btn-secondary r2-back-btn" onClick={handleBack}>
            ← Back to Home
          </button>
        </div>
        <Round2Styles />
      </div>
    );
  }

  // Loading
  if (gamePhase === 'loading') {
    return (
      <div className="r2-screen">
        <div className="r2-center">
          <span className="r2-spinner" />
          <p className="r2-status-text">Loading round…</p>
        </div>
        <Round2Styles />
      </div>
    );
  }

  // Waiting for admin to start
  if (gamePhase === 'waiting') {
    return (
      <div className="r2-screen">
        <div className="r2-center">
          <div className="r2-waiting-icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="28" stroke="var(--warning-amber)" strokeWidth="3" fill="none" opacity="0.3" />
              <path d="M32 12l4 8 8 1.5-6 6 1.5 8L32 31.5l-7.5 4 1.5-8-6-6 8-1.5z" stroke="var(--warning-amber)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <h2 className="r2-waiting-title">Hot Seat</h2>
          <p className="r2-status-text">Waiting for the host to start the round…</p>
          <div className="r2-pulse-dots">
            <span /><span /><span />
          </div>
          <button className="btn btn-secondary btn-sm r2-back-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
        <Round2Styles />
      </div>
    );
  }

  // Completed
  if (gamePhase === 'completed') {
    return (
      <div className="r2-screen">
        <Round2Results
          participant={participant}
          questions={questions}
          onBack={handleBack}
        />
        <Round2Styles />
      </div>
    );
  }

  // Active / Transition
  return (
    <div className="r2-screen">
      <div className="r2-game">
        {/* Header */}
        <header className="r2-header">
          <button className="btn btn-secondary btn-sm" onClick={handleBack}>
            ← Back
          </button>
          <h2 className="r2-header-title">Round 2 : Hot Seat</h2>
          <span className="badge badge--warning" style={{ background: 'var(--warning-amber)', color: 'var(--deep-midnight)' }}>
            ● LIVE
          </span>
        </header>

        {error && (
          <div className="toast toast--error r2-error" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        <div className="r2-layout">
          <div className="r2-timer-col">
            <TimerRing
              startedAtMs={questionAnchor}
              durationMs={questionDurationMs}
              onTimeUp={handleTimeUp}
              isPaused={answerLocked || gamePhase === 'transition' || gamePhase === 'held'}
            />
          </div>

          <div className="r2-question-col">
            {currentQuestion ? (
              <QuestionCard
                question={currentQuestion}
                questionNumber={currentQuestionNumber}
                totalQuestions={questions.length}
                timeUp={hasAnswered && selectedOption === null}
                lastResult={lastResult}
                revealed={revealed}
                selectedOption={selectedOption}
              />
            ) : (
              <div className="r2-center">
                <p className="r2-status-text">Waiting for next question…</p>
              </div>
            )}
          </div>
        </div>

        {gamePhase === 'transition' && (
          <div className="r2-transition">
            <p>Next question incoming…</p>
            <span className="r2-spinner" />
          </div>
        )}

        {/* Manual mode: the host decides when the next question goes live (R5) */}
        {gamePhase === 'held' && (
          <div className="r2-transition r2-transition--held">
            <p>
              {revealed
                ? 'Waiting for the host’s next question…'
                : 'Time’s up — waiting for the host’s next question…'}
            </p>
            <span className="r2-spinner" />
          </div>
        )}
      </div>
      <Round2Styles />
    </div>
  );
}

function Round2Styles() {
  return (
    <style>{`
      .r2-screen {
        min-height: 100vh;
      }

      .r2-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 70vh;
        text-align: center;
        gap: var(--space-md);
        padding: var(--space-xl);
      }

      .r2-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid transparent;
        border-top-color: var(--warning-amber);
        border-radius: 50%;
        animation: r2spin 0.8s linear infinite;
      }

      @keyframes r2spin {
        to { transform: rotate(360deg); }
      }

      .r2-status-text {
        font-family: 'Inter', sans-serif;
        font-size: 16px;
        color: var(--pale-gold);
      }

      .r2-waiting-icon {
        animation: r2float 3s ease-in-out infinite;
      }

      .r2-disabled-icon {
        margin-bottom: var(--space-sm);
        filter: drop-shadow(0 0 12px rgba(242,183,5,0.45));
      }

      @keyframes r2float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8px); }
      }

      .r2-waiting-title {
        font-family: 'Poppins', sans-serif;
        font-size: 28px;
        font-weight: 700;
        color: var(--cloud-white);
      }

      .r2-pulse-dots {
        display: flex;
        gap: 8px;
      }

      .r2-pulse-dots span {
        width: 8px;
        height: 8px;
        background: var(--warning-amber);
        border-radius: 50%;
        animation: r2dotPulse 1.4s ease-in-out infinite;
      }

      .r2-pulse-dots span:nth-child(2) {
        animation-delay: 0.2s;
      }

      .r2-pulse-dots span:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes r2dotPulse {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.6); }
        40% { opacity: 1; transform: scale(1); }
      }

      .r2-back-btn {
        margin-top: var(--space-lg);
      }

      .r2-game {
        max-width: 1000px;
        margin: 0 auto;
        padding: var(--space-lg) var(--space-md);
        position: relative;
      }

      .r2-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-xl);
        padding-bottom: var(--space-md);
        border-bottom: 1px solid rgba(245,166,35,0.2);
      }

      .r2-header-title {
        font-family: 'Poppins', sans-serif;
        font-size: 20px;
        font-weight: 700;
        color: var(--warning-amber);
      }

      /* Timer sits centred above the full-width question bar */
      .r2-layout {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-md);
      }

      .r2-timer-col {
        flex-shrink: 0;
      }

      .r2-question-col {
        width: 100%;
        min-width: 0;
      }

      .r2-error {
        position: relative;
        margin-bottom: var(--space-md);
        cursor: pointer;
        bottom: auto;
        right: auto;
      }

      .r2-transition--held {
        border-color: var(--warning-amber);
        color: var(--warning-amber);
      }

      .r2-transition {
        position: fixed;
        bottom: var(--space-xl);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: 14px 24px;
        background: var(--deep-midnight);
        border: 1px solid var(--warning-amber);
        border-radius: var(--radius-pill);
        box-shadow: var(--shadow-card);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        color: var(--warning-amber);
        z-index: 100;
        animation: r2transIn 0.3s ease;
      }

      @keyframes r2transIn {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      @media (max-width: 640px) {
        .r2-header-title {
          font-size: 16px;
        }
      }
    `}</style>
  );
}
