import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import QuestionCard from './QuestionCard';
import Round2Results from './Round2Results';
import PhoneOverlay from './PhoneOverlay';
import PrizeLadder from './PrizeLadder';
import { CONTACT_KIND, DEFAULT_LIFELINE_DURATION_MS, isPhoneLifeline } from './lifelines';
// The rung a question is played for (R16) — shared with the host's console,
// so both screens agree on where the run is standing.
import { rungForQuestion } from '../admin/tiers';

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
 *
 * R10 — lifelines are host-driven too, and reach this screen the same way:
 * `lifeline_state` carries which of the four is available, live or spent, and
 * everything it draws is scoped to `question_id` so a lifeline played on one
 * question cannot bleed onto the next. Call an Expert and Phone a Friend
 * freeze the question countdown and put PhoneOverlay up with a replacement
 * clock of their own; 50:50 empties two option bars; Audience Poll shows a
 * LIVE banner while the room votes and then, once the host ends it, the
 * tally they typed in as a bar chart. The poll freezes the question clock
 * too, from going live until the host hides the chart again (R11).
 *
 * R15 — the reveal is also where the run can end. A wrong answer blacks the
 * question out under a red price tag (QuestionCard), holds it there long
 * enough for the room to read it, and then takes the contestant off the
 * board to Round2Results: the hot seat is over for them, and what they take
 * home is the last guaranteed checkpoint they passed. This device does not
 * advance the round on the way out — the host moves the show on.
 *
 * R12/R13 — a lifeline is picked before it is played, and the pick is what
 * stops the clock. From the moment the host marks the contestant's choice
 * the countdown is frozen; it starts again when that lifeline is genuinely
 * over — the 50:50 strike lands, or the call's own clock runs out.
 */

const TRANSITION_DELAY_MS = 2500; // Time between questions to show feedback
const DEFAULT_DURATION_MS = 10000; // Fallback if round_state.question_duration_ms is unset
const LOCK_POLL_MS = 1200;        // How often to look for the host's lock-in / reveal
const CONTACT_POLL_MS = 3000;     // Refresh of the phone's contact list while a call is live
// How often this device re-reads the round's own state. The lifeline and
// response polls below only run while the round is active, so without this
// a dropped realtime event on the host ending the round would leave a
// contestant sitting on a dead board with the show already moved on. (R15)
const ROUND_STATE_POLL_MS = 2500;
// R15 — how long the blacked-out question and its red tag stay up before a
// knocked-out contestant is taken to their results. Long enough to read the
// number they just lost, short enough that they are not sitting on a dead
// board while the host talks.
const ELIMINATION_HOLD_MS = 4500;

// Returned by checkExistingResponse when the request itself fell over, so a
// dropped read is never mistaken for "the host cleared the answer". (R9: a
// lock-in now waits on the host's reveal, so this row is polled in that state
// for as long as they choose to hold it.)
const READ_FAILED = Symbol('read-failed');

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

  // R15 — a wrong answer ends the run. `eliminated` is this device having
  // let the reveal play out and moved on to the results screen; until it
  // flips, the board is still showing the black question and the red tag.
  const [eliminated, setEliminated] = useState(false);
  const eliminationTimeoutRef = useRef(null);

  // R10 — the four lifeline rows, and the phone book the two call lifelines
  // dial from. `lifelinesLoaded` stays false on a database that has not run
  // migration_v7, which keeps the whole rail off the screen rather than
  // showing four lifelines that could never be played.
  const [lifelines, setLifelines] = useState([]);
  const [lifelinesLoaded, setLifelinesLoaded] = useState(false);
  const [contacts, setContacts] = useState([]);
  // Local anchor for a lifeline's replacement countdown, same reasoning as
  // `questionAnchor` below: the clock starts when this device is told about
  // the call, not when the server logged it.
  const [lifelineAnchor, setLifelineAnchor] = useState(null);
  const lifelineAnchorKeyRef = useRef(null);
  // R13 — has the running call's replacement countdown finished on this
  // device? That is what ends a call and hands the question clock back; the
  // host getting round to pressing End is bookkeeping after the fact.
  const [callTimeUp, setCallTimeUp] = useState(false);
  // Signatures of the last lifeline / contact reads, so a poll that finds
  // nothing new costs no state write and no re-render — same guard the
  // response poll uses above.
  const lifelineSigRef = useRef(undefined);
  const contactSigRef = useRef(undefined);

  // R14 — the prize ladder, and whether the contestant currently has it
  // open over the board. Empty on a database without migration_v10, which
  // keeps the button off their screen rather than offering an empty panel.
  const [ladder, setLadder] = useState([]);
  const [ladderOpen, setLadderOpen] = useState(false);
  const ladderSigRef = useRef(undefined);

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
  // The verdict, for settleQuestion — which has to know whether the reveal
  // it is closing was a right answer or the end of the run, and must not
  // re-subscribe every time one lands. (R15)
  const lastResultRef = useRef(null);
  useEffect(() => { roundStateRef.current = roundState; }, [roundState]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { lastResultRef.current = lastResult; }, [lastResult]);

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

    const { data, error } = await supabase
      .from('responses')
      .select('*')
      .eq('participant_id', participant.participant_id)
      .eq('question_id', questionId)
      .maybeSingle();

    if (error) return READ_FAILED;
    return data;
  }, [participant.participant_id]);

  const syncRoundState = useCallback(async () => {
    const { data } = await supabase
      .from('round_state')
      .select('*')
      .eq('round', 2)
      .single();

    if (data) {
      setRoundState(data);
    }
  }, []);

  // Subscribe to round_state
  useEffect(() => {
    syncRoundState();

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
  }, [syncRoundState]);

  // R15 — polling fallback for the round's own state, same reasoning as the
  // lock-in poll below: realtime to a phone on venue wifi is not something
  // to bet the end of a run on. It matters most for the host ending the
  // round — that event is what takes this contestant to their results, and
  // a missed one has nothing else to catch it. Stops once the round is
  // over, which is the last state this device has any use for.
  useEffect(() => {
    if (roundState?.status === 'completed') return;
    const id = setInterval(syncRoundState, ROUND_STATE_POLL_MS);
    return () => clearInterval(id);
  }, [roundState?.status, syncRoundState]);

  // R10 — lifeline state. Read whole rather than patched from the realtime
  // payload: there are four rows total, so a re-read is as cheap as parsing
  // the event, and it self-heals a missed one.
  const syncLifelines = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('lifeline_state')
      .select('*')
      .eq('round', 2);

    // A database without migration_v7 errors here every time. Leave the rail
    // hidden and say nothing — the host's console is where that gets flagged.
    if (fetchError) return;

    const rows = data || [];
    const sig = rows
      .map((l) => `${l.key}:${l.status}:${l.question_id}:${l.started_at}:${l.duration_ms}:${JSON.stringify(l.removed_options)}:${JSON.stringify(l.poll_votes)}:${l.poll_hidden_at}:${l.picked_at}`)
      .sort()
      .join('|');
    if (sig === lifelineSigRef.current) return;
    lifelineSigRef.current = sig;

    setLifelines(rows);
    setLifelinesLoaded(true);
  }, []);

  const syncContacts = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('lifeline_contacts')
      .select('*')
      .order('sort_order')
      .order('created_at');

    if (fetchError) return;

    const rows = data || [];
    const sig = rows
      .map((c) => `${c.id}:${c.kind}:${c.name}:${c.detail}:${c.avatar_url}:${c.sort_order}`)
      .join('|');
    if (sig === contactSigRef.current) return;
    contactSigRef.current = sig;

    setContacts(rows);
  }, []);

  // R14 — the prize ladder. Re-read rather than patched from the payload,
  // same as the lifelines: the host may re-price a rung or add one
  // mid-show, and the ladder is short enough that re-reading it is cheaper
  // than reasoning about which event changed what.
  const syncLadder = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('prize_ladder')
      .select('*')
      .eq('round', 2)
      .order('level');

    // A database without migration_v10 errors here every time. Leave the
    // ladder empty and say nothing — the host's console flags it.
    if (fetchError) return;

    const rows = data || [];
    const sig = rows.map((r) => `${r.id}:${r.level}:${r.label}:${r.is_milestone}`).join('|');
    if (sig === ladderSigRef.current) return;
    ladderSigRef.current = sig;

    setLadder(rows);
  }, []);

  useEffect(() => {
    syncLifelines();
    syncContacts();
    syncLadder();

    const channel = supabase
      .channel('round2-engine-lifelines')
      // A rung re-priced mid-show lands on the contestant's open ladder
      // without them closing and reopening it. (R14)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prize_ladder' },
        () => syncLadder()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lifeline_state' },
        () => syncLifelines()
      )
      // The host can fix a name while the phone is already on screen, so
      // contact edits have to land live too. (R10)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lifeline_contacts' },
        () => syncContacts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncLifelines, syncContacts, syncLadder]);

  // Polling fallback, for the same reason the lock-in has one: realtime to a
  // phone on venue wifi is not something to bet a lifeline on.
  useEffect(() => {
    if (roundState?.status !== 'active') return;
    const id = setInterval(syncLifelines, LOCK_POLL_MS);
    return () => clearInterval(id);
  }, [roundState?.status, syncLifelines]);

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
    if (existing === READ_FAILED) return; // try again on the next poll

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
    // R15 — their run is over; a fresh serve is for whoever is in the hot
    // seat now, and must not pull this contestant off their results.
    if (eliminated) return;

    if (!questionsLoaded || !roundState) {
      setGamePhase('loading');
      return;
    }

    if (roundState.status === 'inactive') {
      setGamePhase('waiting');
      return;
    }

    if (roundState.status === 'completed') {
      // R15 — the host has ended the round, so this contestant's run is
      // over wherever they had got to: the results screen leads with the
      // last checkpoint they passed, exactly as it does for a knock-out.
      // Whatever this device had in flight goes with the round — a pending
      // auto-advance must not fire an RPC on a round that is finished, and
      // a reveal's hold has nothing left to hold the board for.
      clearTimeout(advanceTimeoutRef.current);
      clearTimeout(eliminationTimeoutRef.current);
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
    // R14 — a new serve puts the board back. The countdown starts on this
    // beat, and a ladder left open over the question is time the
    // contestant cannot use.
    setLadderOpen(false);

    // A response may already exist - page reload, or a re-serve that did not
    // clear responses. Reflect it so the verdict survives a refresh.
    checkExistingResponse(currentQ.id).then((existing) => {
      if (!existing || existing === READ_FAILED) return;
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
  }, [roundState, questionsLoaded, questions, checkExistingResponse, eliminated]);

  // Once the question is settled — the timer ran out on an unanswered
  // question, or the host revealed the verdict — hand the round on: hold for
  // the host in manual mode, otherwise run the transition and advance. (R5)
  const settleQuestion = useCallback(() => {
    if (!roundStateRef.current || roundStateRef.current.status !== 'active') return;

    // R15 — a wrong answer is not a question to move on from, it is the end
    // of the run. The board holds the blacked-out question and the red tag
    // for a beat, then this contestant leaves for their results. Nothing
    // here advances the round: the host does that when the hot seat is
    // actually being handed over, and a knocked-out contestant's device
    // must not move the show on behind their back.
    if (lastResultRef.current && lastResultRef.current.is_correct === false) {
      setGamePhase('eliminated');
      clearTimeout(eliminationTimeoutRef.current);
      eliminationTimeoutRef.current = setTimeout(
        () => setEliminated(true),
        ELIMINATION_HOLD_MS
      );
      return;
    }

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
    if (!revealed) {
      // R15 — the host can take a reveal back (clear the answer and re-lock
      // it). Everything that reveal set in motion walks back with it, the
      // pending exit most of all: a contestant must never be shown out on a
      // verdict that has been withdrawn.
      clearTimeout(eliminationTimeoutRef.current);
      setGamePhase((phase) => (phase === 'eliminated' ? 'active' : phase));
      // And if they were already off the board, they come back to it. The
      // only way this fires is the host clearing the answer on the question
      // that is still live — which is them saying it was locked in wrong.
      setEliminated(false);
      return;
    }
    settleQuestion();
  }, [revealed, settleQuestion]);

  // Cancel pending timers if we unmount first. (ISSUES 3.9)
  useEffect(() => () => {
    clearTimeout(advanceTimeoutRef.current);
    clearTimeout(eliminationTimeoutRef.current);
  }, []);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const currentQuestion = roundState
    ? questions.find((q) => q.order_index === roundState.current_question_index) || null
    : null;

  // R15/R16 — the rung this question is played for, so the reveal has a
  // number to put on the blacked-out board. The question says which rung it
  // is for; on a database without migration_v11 it does not, and there the
  // queue was the ladder, so its position stands in. The question's own prize
  // wins where it has one — that is what the bar above it has been showing
  // all along.
  const currentLevel = rungForQuestion(currentQuestion, questions);
  const currentRung = ladder.find((r) => r.level === currentLevel) || null;
  const currentPrizeLabel = currentQuestion?.prize || currentRung?.label || null;

  // R16 — what the board counts. "Question 3 of 5" was the queue's length
  // back when the queue was the run; with a pool per rung the bank may hold
  // thirty questions for a ten-rung climb, and the contestant is climbing the
  // ladder, not reading the bank.
  const boardNumber = currentLevel ?? 0;
  const boardTotal = ladder.length || questions.length;

  // Per-question time wins over the round default. (R8)
  const questionDurationMs =
    currentQuestion?.duration_ms ?? roundState?.question_duration_ms ?? DEFAULT_DURATION_MS;

  // R9 — the host has the answer; the clock stops there and stays stopped for
  // this question. Revealing does not restart it, so the countdown can never
  // run out from under an answer that is already in.
  const answerLocked = selectedOption !== null;

  // ─── Lifelines (R10) ────────────────────────────────────────
  // Everything below is scoped to the live question: a lifeline row keeps its
  // question_id after it is spent, which is exactly what stops a 50:50 struck
  // on one question from emptying bars on the next.
  const activeLifeline =
    (currentQuestion &&
      lifelines.find(
        (l) => l.status === 'active' && l.question_id === currentQuestion.id
      )) ||
    null;

  // R11 — the audience poll's result. It shows once the host has ended the
  // poll, which is why this keys off `used` rather than `active`: while the
  // poll is live the board carries the LIVE banner and nothing else, and the
  // chart is the publish. Scoped to the question it was played on, like
  // everything else here, so it leaves with the next serve. A row with no
  // `poll_votes` at all is a database still on the old schema, or a poll the
  // host ended without a tally — either way, no chart.
  const audiencePoll = lifelines.find((l) => l.key === 'audience_poll');
  const pollVotes =
    currentQuestion &&
      audiencePoll?.status === 'used' &&
      audiencePoll.question_id === currentQuestion.id &&
      Array.isArray(audiencePoll.poll_votes) &&
      // The host has not taken it back off the board yet. (R11)
      !audiencePoll.poll_hidden_at
      ? audiencePoll.poll_votes
      : null;

  // R11 — and the poll holds the question clock for as long as it is on
  // this screen, the way a call does: first the LIVE banner while the room
  // votes, then the chart, until the host hides it. Nobody can be asked to
  // think against a running clock while the room's answer is sitting in
  // front of them. Hiding the chart is what hands the clock back.
  const pollHolding = activeLifeline?.key === 'audience_poll' || pollVotes !== null;

  // R12 — the medallion on the crossing point of the option rows is the
  // lifeline this question belongs to, which is not the same thing as the
  // lifeline that is running. A lifeline is picked first — the contestant
  // names it, the host marks it, the badge comes up — and played a moment
  // later. A running lifeline wins over a picked one, so announcing the
  // next one mid-call cannot pull the badge off the call.
  const pickedLifeline =
    (currentQuestion &&
      lifelines.find((l) => l.picked_at && l.question_id === currentQuestion.id)) ||
    null;

  const chosenLifeline = activeLifeline || pickedLifeline;

  // R12 — and the rail marks the pick as well as the play. Between naming a
  // lifeline and the host playing it there is a beat where nothing is
  // running, and the lit badge is the only thing telling the contestant the
  // host heard them right. A row that is already live or spent keeps the
  // status it has: `picked` is the weakest of the three.
  //
  // One badge is lit at a time. The host picking a second lifeline moves
  // the pick (pick_lifeline clears the others), and a lifeline actually
  // being played takes the rail off a pick that is only named — which is
  // how starting the Audience Poll, the one lifeline that is never picked,
  // puts out a 50:50 marked a moment earlier.
  const pickedBadgeKey = activeLifeline ? null : pickedLifeline?.key;

  const lifelineStatuses = Object.fromEntries(
    lifelines.map((l) => [
      l.key,
      l.status === 'available' && l.key === pickedBadgeKey ? 'picked' : l.status,
    ])
  );

  const fiftyFifty = lifelines.find((l) => l.key === 'fifty_fifty');
  const removedOptions =
    currentQuestion && fiftyFifty?.question_id === currentQuestion.id
      ? fiftyFifty.removed_options || []
      : [];

  // R13 — the pick is what stops the clock, not the play.
  //
  // A contestant who has said "50:50" has stopped thinking about the
  // question and started waiting on the host, who still has to read two
  // options off the console or dial a number before anything happens.
  // Running the countdown through that charges them for the host's setup
  // time, so it freezes the moment the lifeline is marked and starts again
  // only when that lifeline is genuinely finished. Finished means something
  // different for each of them:
  //
  //   50:50  — the strike lands. Two bars go empty, there is something new
  //            to think about, and the clock is theirs again.
  //   a call — the call's own countdown runs out (or the host ends it
  //            early). `callTimeUp` is this device watching that happen, so
  //            the question clock comes back on the beat rather than
  //            whenever the host next looks at the console.
  //
  // The Audience Poll is not in here: it is never picked, and `pollHolding`
  // above already holds the clock from going live until the chart is hidden.
  const pickHolding = (() => {
    const key = chosenLifeline?.key;
    if (!key || key === 'audience_poll') return false;
    if (chosenLifeline.status === 'used') return false;
    if (key === 'fifty_fifty') return removedOptions.length === 0;
    return !callTimeUp;
  })();

  // Call an Expert / Phone a Friend take the question's clock away and run
  // one of their own in its place.
  const phoneLifeline = activeLifeline && isPhoneLifeline(activeLifeline.key)
    ? activeLifeline
    : null;

  const phoneContacts = phoneLifeline
    ? contacts.filter((c) => c.kind === CONTACT_KIND[phoneLifeline.key])
    : [];

  // R6/R10 — anchor the replacement countdown on this device's clock the
  // moment it learns the call is on, exactly as the question's own countdown
  // is anchored. Keyed on started_at so re-playing the lifeline re-anchors.
  const phoneAnchorKey = phoneLifeline
    ? `${phoneLifeline.key}:${phoneLifeline.started_at}`
    : null;

  useEffect(() => {
    if (lifelineAnchorKeyRef.current === phoneAnchorKey) return;
    lifelineAnchorKeyRef.current = phoneAnchorKey;
    setLifelineAnchor(phoneAnchorKey ? Date.now() : null);
    setCallTimeUp(false);
  }, [phoneAnchorKey]);

  // The host may still be typing the contact list as the phone goes up, so
  // it is re-read while a call is live rather than only on a realtime event.
  useEffect(() => {
    if (!phoneAnchorKey) return;
    const id = setInterval(syncContacts, CONTACT_POLL_MS);
    return () => clearInterval(id);
  }, [phoneAnchorKey, syncContacts]);

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

  // R15 — knocked out. The reveal has had its beat on the board and this
  // contestant's run is over: the results screen leads with the checkpoint
  // they take home, not with the question that ended it.
  if (eliminated) {
    return (
      <div className="r2-screen">
        <Round2Results
          participant={participant}
          questions={questions}
          ladder={ladder}
          eliminated
          onBack={handleBack}
        />
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

  // Completed — the host ended the round. Same screen as a knock-out, and
  // for the same reason: what the contestant takes home is the last
  // guaranteed checkpoint they passed, whether the run ended on a wrong
  // answer or the host called time on it. A verdict that was wrong still
  // reads as the end of their run here — ending the round can cut the
  // board's hold short, and it must not rewrite how the run finished. (R15)
  if (gamePhase === 'completed') {
    return (
      <div className="r2-screen">
        <Round2Results
          participant={participant}
          questions={questions}
          ladder={ladder}
          eliminated={lastResult?.is_correct === false}
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
          <div className="r2-question-col">
            {currentQuestion ? (
              <QuestionCard
                question={currentQuestion}
                questionNumber={boardNumber}
                totalQuestions={boardTotal}
                timeUp={hasAnswered && selectedOption === null}
                lastResult={lastResult}
                revealed={revealed}
                selectedOption={selectedOption}
                timerStartedAtMs={questionAnchor}
                timerDurationMs={questionDurationMs}
                onTimeUp={handleTimeUp}
                // R10/R11/R13 — the clock is held by whatever the board is
                // waiting on: a lifeline that has been picked and is not
                // finished yet, or the audience poll, from going live until
                // the host hides its result.
                timerPaused={
                  answerLocked ||
                  pickHolding ||
                  pollHolding ||
                  gamePhase === 'transition' ||
                  gamePhase === 'held' ||
                  gamePhase === 'eliminated'
                }
                lifelineStatuses={lifelinesLoaded ? lifelineStatuses : null}
                activeLifelineKey={activeLifeline?.key || null}
                chosenLifelineKey={chosenLifeline?.key || null}
                lifelineHolding={pickHolding || pollHolding}
                removedOptions={removedOptions}
                pollVotes={pollVotes}
                // R14 — no ladder set, no button: an empty panel is worse
                // than no way to open one.
                onOpenLadder={ladder.length > 0 ? () => setLadderOpen(true) : null}
                // R15 — what the reveal puts on the blacked-out question.
                prizeLabel={currentPrizeLabel}
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

        {/* R10 — Call an Expert / Phone a Friend: the phone, its contact list
            and the replacement countdown, over the whole board.

            R13 — and it comes down the moment the call's clock runs out,
            because that is when the question clock starts again: leaving the
            handset over the board would run their countdown behind a screen
            they cannot read the question through. The lifeline row stays
            `active` until the host ends it; that is now only bookkeeping. */}
        {phoneLifeline && !callTimeUp && (
          <PhoneOverlay
            lifelineKey={phoneLifeline.key}
            contacts={phoneContacts}
            startedAtMs={lifelineAnchor}
            durationMs={phoneLifeline.duration_ms || DEFAULT_LIFELINE_DURATION_MS}
            onTimeUp={() => setCallTimeUp(true)}
          />
        )}

        {/* R14 — the money tree, when the contestant asks for it. It sits
            under the phone deliberately: a call is the one thing on this
            screen with a clock of its own running, and the ladder must not
            be able to cover it. */}
        {ladderOpen && ladder.length > 0 && (
          <PrizeLadder
            rungs={ladder}
            // The rung the live question is played for (R16) — the same
            // number the board counts in "Question 3 of 10", so a host
            // picking a different question from the same tier does not move
            // the contestant on the ladder.
            currentLevel={currentLevel || null}
            lifelineStatuses={lifelinesLoaded ? lifelineStatuses : null}
            onClose={() => setLadderOpen(false)}
          />
        )}

        {/* Manual mode: the host decides when the next question goes live (R5) */}
        {gamePhase === 'held' && (
          <div className="r2-transition r2-transition--held">
            <p>
              {revealed
                ? 'Waiting for the host’s next question…'
                : 'Time’s up,  waiting for the host’s next question…'}
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

      /* The timer dome lives inside the card, docked on the question bar */
      .r2-layout {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
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
