import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import QuestionCard from './QuestionCard';
import TimerRing from './TimerRing';
import Round1Results from './Round1Results';

/**
 * Module 4 — Round1Engine
 *
 * Core orchestrator for the Fastest Finger First round.
 *
 * Game states:
 *   'waiting'     — round_state.status is 'inactive', waiting for admin to start
 *   'active'      — a question is live, timer counting down
 *   'transition'  — brief pause between questions to show feedback (2s)
 *   'completed'   — round is done, show results
 *
 * Props:
 *   participant — { participant_id, roll_no, name }
 */

const TRANSITION_DELAY_MS = 2500; // Time between questions to show feedback

export default function Round1Engine({ participant }) {
  const navigate = useNavigate();

  // Round state from Supabase
  const [roundState, setRoundState] = useState(null);

  // Questions
  const [questions, setQuestions] = useState([]);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);

  // Game state
  const [gamePhase, setGamePhase] = useState('loading'); // loading | waiting | active | transition | completed
  const [selectedOption, setSelectedOption] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [error, setError] = useState(null);

  // Track which questions we've already answered (persists across re-renders)
  const answeredQuestionsRef = useRef(new Set());

  // ─── Load questions ──────────────────────────────────────────
  useEffect(() => {
    async function loadQuestions() {
      const { data, error: fetchError } = await supabase
        .from('questions')
        .select('*')
        .eq('round', 1)
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

  // ─── Check if current question was already answered ──────────
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

  // ─── Subscribe to round_state ────────────────────────────────
  useEffect(() => {
    // Initial fetch
    async function fetchRoundState() {
      const { data } = await supabase
        .from('round_state')
        .select('*')
        .eq('round', 1)
        .single();

      if (data) {
        setRoundState(data);
      }
    }

    fetchRoundState();

    // Realtime subscription
    const channel = supabase
      .channel('round1-engine-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_state', filter: 'round=eq.1' },
        (payload) => {
          setRoundState(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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

    if (roundState.status === 'active') {
      // New question arrived — reset answer state
      const currentQ = questions[roundState.current_question_index];
      if (!currentQ) {
        setGamePhase('completed');
        return;
      }

      // Check if we already answered this question (page refresh scenario)
      if (answeredQuestionsRef.current.has(currentQ.id)) {
        // Already answered locally, stay in active but keep feedback visible
        setGamePhase('active');
        return;
      }

      // Check server for existing response
      checkExistingResponse(currentQ.id).then((existing) => {
        if (existing) {
          // We answered this before (page reload)
          answeredQuestionsRef.current.add(currentQ.id);
          setSelectedOption(existing.selected_option);
          setLastResult({
            is_correct: existing.is_correct,
            points_awarded: existing.points_awarded,
            response_time_ms: existing.response_time_ms,
          });
          setHasAnswered(true);
        } else {
          // Fresh question
          setSelectedOption(null);
          setLastResult(null);
          setHasAnswered(false);
        }
        setGamePhase('active');
      });
    }
  }, [roundState, questionsLoaded, questions, checkExistingResponse]);

  // ─── Handle answer submission ────────────────────────────────
  const handleAnswer = useCallback(async (optionIndex) => {
    if (hasAnswered || !roundState || gamePhase !== 'active') return;

    const currentQ = questions[roundState.current_question_index];
    if (!currentQ) return;

    setSelectedOption(optionIndex);
    setHasAnswered(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('submit_response', {
        p_participant_id: participant.participant_id,
        p_question_id: currentQ.id,
        p_selected_option: optionIndex,
      });

      if (rpcError) {
        setError(`Submit failed: ${rpcError.message}`);
        setLastResult({
          is_correct: optionIndex === currentQ.correct_option,
          points_awarded: 0,
          response_time_ms: 0,
        });
        return;
      }

      if (data && data.success) {
        answeredQuestionsRef.current.add(currentQ.id);
        setLastResult({
          is_correct: data.is_correct,
          points_awarded: data.points_awarded,
          response_time_ms: data.response_time_ms,
        });
      } else {
        // RPC returned an error (e.g. "Already answered", "Question is not current")
        const errorMsg = data?.error || 'Unknown error';
        console.warn('Submit response RPC:', errorMsg);

        // If already answered, try to fetch the existing response
        if (errorMsg === 'Already answered') {
          const existing = await checkExistingResponse(currentQ.id);
          if (existing) {
            answeredQuestionsRef.current.add(currentQ.id);
            setSelectedOption(existing.selected_option);
            setLastResult({
              is_correct: existing.is_correct,
              points_awarded: existing.points_awarded,
              response_time_ms: existing.response_time_ms,
            });
          }
        }
      }
    } catch (err) {
      console.error('Submit error:', err);
      setError('Network error submitting answer');
    }
  }, [hasAnswered, roundState, gamePhase, questions, participant.participant_id, checkExistingResponse]);

  // ─── Handle time up → advance question ───────────────────────
  const handleTimeUp = useCallback(async () => {
    if (!roundState || roundState.status !== 'active') return;

    // Mark as answered (time ran out) if not already
    if (!hasAnswered) {
      setHasAnswered(true);
    }

    // Show transition briefly then call advance
    setGamePhase('transition');

    // Wait for transition delay, then call advance RPC
    setTimeout(async () => {
      try {
        await supabase.rpc('advance_question', { p_round: 1 });
        // The realtime subscription will pick up the state change
      } catch (err) {
        console.error('Advance question error:', err);
      }
    }, TRANSITION_DELAY_MS);
  }, [roundState, hasAnswered]);

  // ─── Navigate back ──────────────────────────────────────────
  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  // ─── Derived values ─────────────────────────────────────────
  const currentQuestion = roundState && questions.length > 0
    ? questions[roundState.current_question_index] || null
    : null;

  const currentQuestionNumber = roundState
    ? roundState.current_question_index + 1
    : 0;

  // ─── Render ─────────────────────────────────────────────────

  // Loading
  if (gamePhase === 'loading') {
    return (
      <div className="r1-screen">
        <div className="r1-center">
          <span className="r1-spinner" />
          <p className="r1-status-text">Loading round…</p>
        </div>
      </div>
    );
  }

  // Waiting for admin to start
  if (gamePhase === 'waiting') {
    return (
      <div className="r1-screen">
        <div className="r1-center">
          <div className="r1-waiting-icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="28" stroke="var(--ocean-aqua)" strokeWidth="3" fill="none" opacity="0.3" />
              <path d="M32 18v14l10 6" stroke="var(--ocean-aqua)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="r1-waiting-title">Fastest Finger First</h2>
          <p className="r1-status-text">Waiting for the host to start the round…</p>
          <div className="r1-pulse-dots">
            <span /><span /><span />
          </div>
          <button className="btn btn-secondary btn-sm r1-back-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
        <Round1Styles />
      </div>
    );
  }

  // Completed — show results
  if (gamePhase === 'completed') {
    return (
      <div className="r1-screen">
        <Round1Results
          participant={participant}
          questions={questions}
          onBack={handleBack}
        />
        <Round1Styles />
      </div>
    );
  }

  // Active / Transition — show question + timer
  return (
    <div className="r1-screen">
      <div className="r1-game">
        {/* Header */}
        <header className="r1-header">
          <button className="btn btn-secondary btn-sm" onClick={handleBack}>
            ← Back
          </button>
          <h2 className="r1-header-title">Round 1</h2>
          <span className="badge badge--active">● LIVE</span>
        </header>

        {/* Error toast */}
        {error && (
          <div className="toast toast--error r1-error" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        {/* Game layout */}
        <div className="r1-layout">
          {/* Timer */}
          <div className="r1-timer-col">
            <TimerRing
              questionStartedAt={roundState?.question_started_at}
              durationMs={10000}
              onTimeUp={handleTimeUp}
              isPaused={gamePhase === 'transition'}
            />
          </div>

          {/* Question */}
          <div className="r1-question-col">
            {currentQuestion ? (
              <QuestionCard
                question={currentQuestion}
                questionNumber={currentQuestionNumber}
                totalQuestions={questions.length}
                onAnswer={handleAnswer}
                disabled={hasAnswered || gamePhase === 'transition'}
                lastResult={lastResult}
                selectedOption={selectedOption}
              />
            ) : (
              <div className="r1-center">
                <p className="r1-status-text">Waiting for next question…</p>
              </div>
            )}
          </div>
        </div>

        {/* Transition overlay */}
        {gamePhase === 'transition' && (
          <div className="r1-transition">
            <p>Next question incoming…</p>
            <span className="r1-spinner" />
          </div>
        )}
      </div>
      <Round1Styles />
    </div>
  );
}


/* ===== Extracted styles component ===== */

function Round1Styles() {
  return (
    <style>{`
      .r1-screen {
        min-height: 100vh;
      }

      .r1-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 70vh;
        text-align: center;
        gap: var(--space-md);
        padding: var(--space-xl);
      }

      .r1-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid transparent;
        border-top-color: var(--ocean-aqua);
        border-radius: 50%;
        animation: r1spin 0.8s linear infinite;
      }

      @keyframes r1spin {
        to { transform: rotate(360deg); }
      }

      .r1-status-text {
        font-family: 'Inter', sans-serif;
        font-size: 16px;
        color: var(--serene-seafoam);
      }

      /* Waiting */
      .r1-waiting-icon {
        animation: r1float 3s ease-in-out infinite;
      }

      @keyframes r1float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8px); }
      }

      .r1-waiting-title {
        font-family: 'Poppins', sans-serif;
        font-size: 28px;
        font-weight: 700;
        color: var(--cloud-white);
      }

      .r1-pulse-dots {
        display: flex;
        gap: 8px;
      }

      .r1-pulse-dots span {
        width: 8px;
        height: 8px;
        background: var(--ocean-aqua);
        border-radius: 50%;
        animation: r1dotPulse 1.4s ease-in-out infinite;
      }

      .r1-pulse-dots span:nth-child(2) {
        animation-delay: 0.2s;
      }

      .r1-pulse-dots span:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes r1dotPulse {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.6); }
        40% { opacity: 1; transform: scale(1); }
      }

      .r1-back-btn {
        margin-top: var(--space-lg);
      }

      /* Game layout */
      .r1-game {
        max-width: 900px;
        margin: 0 auto;
        padding: var(--space-lg) var(--space-md);
        position: relative;
      }

      .r1-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-xl);
        padding-bottom: var(--space-md);
        border-bottom: 1px solid rgba(36,184,175,0.15);
      }

      .r1-header-title {
        font-family: 'Poppins', sans-serif;
        font-size: 20px;
        font-weight: 700;
      }

      .r1-layout {
        display: flex;
        gap: var(--space-xl);
        align-items: flex-start;
      }

      .r1-timer-col {
        flex-shrink: 0;
        position: sticky;
        top: var(--space-lg);
      }

      .r1-question-col {
        flex: 1;
        min-width: 0;
      }

      .r1-error {
        position: relative;
        margin-bottom: var(--space-md);
        cursor: pointer;
        bottom: auto;
        right: auto;
      }

      /* Transition overlay */
      .r1-transition {
        position: fixed;
        bottom: var(--space-xl);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: 14px 24px;
        background: var(--deep-midnight);
        border: 1px solid var(--twilight-teal);
        border-radius: var(--radius-pill);
        box-shadow: var(--shadow-card);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        color: var(--ocean-aqua);
        z-index: 100;
        animation: r1transIn 0.3s ease;
      }

      @keyframes r1transIn {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      /* Responsive */
      @media (max-width: 640px) {
        .r1-layout {
          flex-direction: column;
          align-items: center;
        }

        .r1-timer-col {
          position: static;
        }

        .r1-question-col {
          width: 100%;
        }

        .r1-header-title {
          font-size: 16px;
        }
      }
    `}</style>
  );
}
