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
 */

const TRANSITION_DELAY_MS = 2500;

export default function Round2Engine({ participant }) {
  const navigate = useNavigate();

  const [roundState, setRoundState] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [gamePhase, setGamePhase] = useState('loading'); 
  const [selectedOption, setSelectedOption] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [error, setError] = useState(null);

  const answeredQuestionsRef = useRef(new Set());

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

  // Derive game phase
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
      const currentQ = questions[roundState.current_question_index];
      if (!currentQ) {
        setGamePhase('completed');
        return;
      }

      if (answeredQuestionsRef.current.has(currentQ.id)) {
        setGamePhase('active');
        return;
      }

      checkExistingResponse(currentQ.id).then((existing) => {
        if (existing) {
          answeredQuestionsRef.current.add(currentQ.id);
          setSelectedOption(existing.selected_option);
          setLastResult({
            is_correct: existing.is_correct,
            points_awarded: existing.points_awarded,
            response_time_ms: existing.response_time_ms,
          });
          setHasAnswered(true);
        } else {
          setSelectedOption(null);
          setLastResult(null);
          setHasAnswered(false);
        }
        setGamePhase('active');
      });
    }
  }, [roundState, questionsLoaded, questions, checkExistingResponse]);

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
        const errorMsg = data?.error || 'Unknown error';
        console.warn('Submit response RPC:', errorMsg);

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

  const handleTimeUp = useCallback(async () => {
    if (!roundState || roundState.status !== 'active') return;

    if (!hasAnswered) {
      setHasAnswered(true);
    }

    setGamePhase('transition');

    setTimeout(async () => {
      try {
        await supabase.rpc('advance_question', { p_round: 2 });
      } catch (err) {
        console.error('Advance question error:', err);
      }
    }, TRANSITION_DELAY_MS);
  }, [roundState, hasAnswered]);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const currentQuestion = roundState && questions.length > 0
    ? questions[roundState.current_question_index] || null
    : null;

  const currentQuestionNumber = roundState
    ? roundState.current_question_index + 1
    : 0;

  // Render logic

  // If we are not the active participant and the round is active/completed, we shouldn't really be here,
  // but if we are, display a disabled view.
  if (roundState && roundState.status !== 'inactive' && roundState.active_participant_id !== participant.participant_id) {
    return (
      <div className="r2-screen">
        <div className="r2-center">
          <div className="r2-disabled-icon">🔒</div>
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
              questionStartedAt={roundState?.question_started_at}
              durationMs={10000}
              onTimeUp={handleTimeUp}
              isPaused={gamePhase === 'transition'}
            />
          </div>

          <div className="r2-question-col">
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
        color: var(--serene-seafoam);
      }

      .r2-waiting-icon {
        animation: r2float 3s ease-in-out infinite;
      }

      .r2-disabled-icon {
        font-size: 48px;
        margin-bottom: var(--space-sm);
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
        max-width: 900px;
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

      .r2-layout {
        display: flex;
        gap: var(--space-xl);
        align-items: flex-start;
      }

      .r2-timer-col {
        flex-shrink: 0;
        position: sticky;
        top: var(--space-lg);
      }

      .r2-question-col {
        flex: 1;
        min-width: 0;
      }

      .r2-error {
        position: relative;
        margin-bottom: var(--space-md);
        cursor: pointer;
        bottom: auto;
        right: auto;
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
        .r2-layout {
          flex-direction: column;
          align-items: center;
        }

        .r2-timer-col {
          position: static;
        }

        .r2-question-col {
          width: 100%;
        }

        .r2-header-title {
          font-size: 16px;
        }
      }
    `}</style>
  );
}
