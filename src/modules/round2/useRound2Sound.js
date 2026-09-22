import { useEffect, useRef, useSyncExternalStore } from 'react';
import { engine, openSoundChannel, QUESTION_SUSPENSE } from '../sound';

/**
 * R17 — Round 2's sound, driven from the state the board already mirrors.
 *
 * The board is the speaker (host decision), so nothing here is fired by the
 * host's clicks. Instead the hook reduces what this screen knows — a serve, a
 * lifeline, a lock-in, a reveal — to one `cue`, and only reacts when the cue
 * changes. That is deliberately not event-driven: the engine's polls already
 * heal a dropped realtime event, and a cue derived from state heals with them.
 *
 * Cue, first match wins:
 *
 *   reveal-right / reveal-wrong  the host revealed the verdict
 *   locked                       an answer is in, the verdict is not
 *   poll                         the Audience Poll is live
 *   staged                       (R18) the question is up alone; the options
 *                                and the clock have not been released yet
 *   silent                       the question is over, or waiting on the host
 *   hold                         a lifeline has the question clock stopped
 *   question                     the question is live and the clock is running
 *
 * `hold` takes the bed out with the clock, and `question` brings a bed back
 * with it — the other of the two, from the top (R19). Every return of the
 * clock is one the room should hear: the poll's chart coming off the board,
 * a 50:50 landing, a call ending.
 *
 * A staged question (R18) gets its sting when it goes up and then nothing:
 * the bed belongs to the clock, so it starts when the host releases the
 * options, and the sting is left to finish rather than being cut.
 *
 * The board coming up on a question already in play gets the sting too
 * (R19) — the contestant enters Round 2 after the host has served, so the
 * first question is reached, not served, on this screen.
 *
 * The host's soundboard (SoundBoard.jsx) reaches this same device over the
 * `kbh-sfx` channel: a press plays that clip on its own, over anything else.
 *
 * Sound is always on — there is no switch. The one thing that decides whether
 * a screen makes noise is whether it is the hot seat's: every participant with
 * the Round 2 page open hears the same broadcasts, and only the nominated
 * contestant's screen is the one the room is watching. The other gate is the
 * browser's own: nothing can play until the page has had a click, key press or
 * tap, which the engine waits for on its own (see armUnlock). Until then the
 * hook stays quiet rather than firing cues that would be refused.
 *
 * Args — all derived by Round2Engine:
 *   isHotSeat   this device is the nominated contestant's screen — the speaker
 *   boardActive the live board is on screen (not loading / waiting / results)
 *   serveKey    `${question.id}:${question_started_at}`, null between questions
 *   settled     the first read of this serve's response has come back
 *   optionsHidden the live question is staged and its options are still withheld
 *   pollLive    the Audience Poll is running right now
 *   answerLocked / revealed / isCorrect   the response, as this screen sees it
 *   hold        a pick or the poll's chart has the question clock stopped
 *   silent      the board is past the point of a live question
 */
export default function useRound2Sound({
  isHotSeat,
  boardActive,
  serveKey,
  optionsHidden,
  settled,
  pollLive,
  answerLocked,
  revealed,
  isCorrect,
  hold,
  silent,
}) {
  const unlocked = useSyncExternalStore(engine.subscribeUnlocked, engine.isUnlocked);
  const channelRef = useRef(null);

  // Load the clips and wait for the page's first gesture.
  useEffect(() => engine.armUnlock(), []);

  // Read at call time, not closed over: the channel is opened once, and a
  // command has to be judged against who the hot seat is when it arrives.
  const canSoundRef = useRef(false);
  useEffect(() => {
    canSoundRef.current = isHotSeat && unlocked;
  }, [isHotSeat, unlocked]);

  // The host's soundboard, and the presence that lets it see this screen.
  useEffect(() => {
    const channel = openSoundChannel({
      onCommand: (cmd) => {
        if (!canSoundRef.current) return;
        if (cmd?.type === 'play') engine.playExclusive(cmd.id);
        else if (cmd?.type === 'stop') engine.stopAll();
      },
    });
    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      channel.close();
      engine.stopAll({ fade: false });
    };
  }, []);

  useEffect(() => {
    channelRef.current?.track({ speaker: isHotSeat, unlocked });
  }, [isHotSeat, unlocked]);

  const cue = revealed
    ? (isCorrect === false ? 'reveal-wrong' : 'reveal-right')
    : answerLocked
      ? 'locked'
      : pollLive
        ? 'poll'
        : optionsHidden
          ? 'staged'
          : silent
            ? 'silent'
            : hold
              ? 'hold'
              : 'question';

  const live = unlocked && isHotSeat && boardActive;
  const stateRef = useRef(null);

  useEffect(() => {
    if (!live) {
      // Off the board (results, round over): whatever the board had playing
      // goes with it. A device that never had the board has nothing of its
      // own to stop.
      if (stateRef.current) {
        engine.stopAll();
        stateRef.current = null;
      }
      return;
    }

    let s = stateRef.current;

    // First look at the board — the contestant entering Round 2, a refresh
    // mid-question, the page's first click landing halfway through. What is
    // on screen is the baseline rather than a run of events, and only one
    // thing is played over it: a question still being answered opens with its
    // sting (see openBoard). Anything further along — an answer in, a verdict
    // up — keeps the baseline's silence. The baseline waits for the response
    // read, so a lock-in that is still loading is not mistaken for a new one,
    // and the opening cue is decided on what that read comes back with.
    if (!s) {
      s = stateRef.current = {
        serveKey,
        cue,
        hydrating: serveKey != null && !settled,
        opening: true,
        track: null,
        lastTrack: null,
      };
      if (!s.hydrating) openBoard(s, serveKey, cue, optionsHidden);
      return;
    }

    if (serveKey !== s.serveKey) {
      s.serveKey = serveKey;
      s.hydrating = false;
      s.cue = 'idle';
      engine.stopAll();
      if (serveKey == null) return;

      s.opening = false;
      if (optionsHidden) {
        // Staged: the sting for the question going up, and the bed waits for
        // the clock.
        engine.play('question-sting');
        s.cue = 'staged';
      } else {
        engine.playThen('question-sting', nextBed(s), { loopNext: true });
        s.cue = 'question';
      }
    }

    if (s.hydrating) {
      if (settled) {
        s.hydrating = false;
        s.cue = cue;
        openBoard(s, serveKey, cue, optionsHidden);
      }
      return;
    }

    if (cue === s.cue) return;
    const from = s.cue;
    s.cue = cue;
    transition(from, cue, s);
  }, [live, serveKey, optionsHidden, settled, cue]);
}

// Random, but never the bed that was on last.
function pickSuspense(last) {
  const options = QUESTION_SUSPENSE.filter((id) => id !== last);
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * R19 — the next suspense bed, and the only place one is chosen. Always the
 * other of the two, so a bed that starts again after a lifeline, a lock-in or
 * a new serve is audibly a new one rather than the same pad picking back up.
 * Remembered on the state, so it carries across questions.
 */
function nextBed(s) {
  s.track = pickSuspense(s.track ?? s.lastTrack);
  s.lastTrack = s.track;
  return s.track;
}

/**
 * R19 — the board coming up on a question that is already live: the sting,
 * then the bed, exactly as if the serve had happened here. The contestant
 * reaches this screen by entering Round 2 *after* the host has served, so
 * without this the first question of the night is played out in silence.
 *
 * Only for a question still being answered. A board that comes up on an
 * answer already locked, a verdict, or a poll keeps its silence: replaying a
 * stinger for a moment that has already passed is worse than a quiet board.
 */
function openBoard(s, serveKey, cue, optionsHidden) {
  if (!s.opening) return;
  s.opening = false;
  if (serveKey == null) return;
  if (cue !== 'question' && cue !== 'staged') return;

  if (optionsHidden) {
    // Staged: the sting alone, and the bed waits for the clock. (R18)
    engine.play('question-sting');
    return;
  }
  engine.playThen('question-sting', nextBed(s), { loopNext: true });
}

// Every branch below that leaves the poll behind stops everything, the
// poll's own bed with it, so there is nothing to unwind from `from` first.
function transition(from, to, s) {
  switch (to) {
    case 'question':
      // Options just released on a staged question: the bed starts under the
      // clock, and the sting from the question going up is not cut for it.
      if (from === 'staged') {
        engine.play(nextBed(s), { loop: true });
        break;
      }
      // R19 — the clock is the contestant's again: the poll's chart is off
      // the board, or a lifeline has finished, or the host cleared an answer.
      // The bed starts from the top, and it is the other one of the two — a
      // pad resuming mid-phrase is not something the room hears as the
      // question coming back, and this moment is the one that has to land.
      engine.stopAll();
      engine.play(nextBed(s), { loop: true });
      break;

    case 'hold':
      // R19 — the bed goes out with the clock. It is stopped rather than
      // frozen: what comes back when the lifeline closes is a new bed from
      // the top, so there is nothing left here to pick up.
      engine.stopAll();
      break;

    case 'poll':
      engine.stopAll();
      engine.play('suspense-poll', { loop: true });
      break;

    case 'staged':
      // Only reached by a state change on a question already up (the sting
      // itself is started by the serve branch above).
      engine.stopAll();
      break;

    case 'silent':
      engine.stopAll();
      break;

    case 'locked':
      // R19 — the lock sting, then a question bed rather than the
      // after-lock clip, so the wait for the verdict is the same music the
      // question was played over. The other of the two, for the change of
      // colour the lock-in deserves. (`suspense-locked` is still on the
      // soundboard for the host to fire by hand.)
      engine.stopAll();
      engine.playThen('lock-answer', nextBed(s), { loopNext: true });
      break;

    case 'reveal-right':
      engine.stopAll();
      engine.play('right-answer');
      break;

    case 'reveal-wrong':
      engine.stopAll();
      engine.play('wrong-answer');
      break;

    default:
      break;
  }
}
