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
 *   silent                       the question is over, or waiting on the host
 *   hold                         a lifeline has the question clock stopped
 *   question                     the question is live and the clock is running
 *
 * `hold` pauses the bed and `question` picks it up where it stopped, so the
 * sound freezes and resumes exactly with the countdown.
 *
 * The host's soundboard (SoundBoard.jsx) reaches this same device over the
 * `kbh-sfx` channel: a press plays that clip on its own, over anything else.
 * A device that has not been made a speaker (SoundToggle) ignores all of it.
 *
 * Args — all derived by Round2Engine:
 *   isHotSeat   this device is the nominated contestant's board
 *   boardActive the live board is on screen (not loading / waiting / results)
 *   serveKey    `${question.id}:${question_started_at}`, null between questions
 *   settled     the first read of this serve's response has come back
 *   pollLive    the Audience Poll is running right now
 *   answerLocked / revealed / isCorrect   the response, as this screen sees it
 *   hold        a pick or the poll's chart has the question clock stopped
 *   silent      the board is past the point of a live question
 */
export default function useRound2Sound({
  isHotSeat,
  boardActive,
  serveKey,
  settled,
  pollLive,
  answerLocked,
  revealed,
  isCorrect,
  hold,
  silent,
}) {
  const speaker = useSyncExternalStore(engine.subscribeSpeaker, engine.isSpeaker);
  const channelRef = useRef(null);

  // The host's soundboard, and the presence that lets it see this screen.
  useEffect(() => {
    const channel = openSoundChannel({
      onCommand: (cmd) => {
        if (!engine.isSpeaker()) return;
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
    channelRef.current?.track({ speaker });
  }, [speaker]);

  const cue = revealed
    ? (isCorrect === false ? 'reveal-wrong' : 'reveal-right')
    : answerLocked
      ? 'locked'
      : pollLive
        ? 'poll'
        : silent
          ? 'silent'
          : hold
            ? 'hold'
            : 'question';

  const live = speaker && isHotSeat && boardActive;
  const stateRef = useRef(null);

  useEffect(() => {
    if (!live) {
      // Off the board (results, round over, sound muted): whatever the board
      // had playing goes with it. A device that never had the board — a
      // speaker that is not the hot seat — has nothing of its own to stop.
      if (stateRef.current) {
        engine.stopAll();
        stateRef.current = null;
      }
      return;
    }

    let s = stateRef.current;

    // First look at the board. Whatever it is already showing — a refresh
    // mid-question, sound switched on halfway through — is the baseline, not
    // an event: replaying a stinger for a moment that already happened is
    // worse than a quiet board. The baseline waits for the response read, so
    // a lock-in that is still loading is not mistaken for a new one.
    if (!s) {
      s = stateRef.current = {
        serveKey,
        cue,
        hydrating: serveKey != null && !settled,
        track: null,
        lastTrack: null,
      };
      return;
    }

    if (serveKey !== s.serveKey) {
      s.serveKey = serveKey;
      s.hydrating = false;
      s.cue = 'idle';
      engine.stopAll();
      if (serveKey == null) return;

      s.track = pickSuspense(s.lastTrack);
      s.lastTrack = s.track;
      engine.playThen('question-sting', s.track, { loopNext: true });
      s.cue = 'question';
    }

    if (s.hydrating) {
      if (settled) {
        s.hydrating = false;
        s.cue = cue;
      }
      return;
    }

    if (cue === s.cue) return;
    const from = s.cue;
    s.cue = cue;
    transition(from, cue, s);
  }, [live, serveKey, settled, cue]);
}

// Random, but never the bed the previous question had.
function pickSuspense(last) {
  const options = QUESTION_SUSPENSE.filter((id) => id !== last);
  return options[Math.floor(Math.random() * options.length)];
}

function transition(from, to, s) {
  if (from === 'poll') engine.stop('suspense-poll');

  switch (to) {
    case 'question':
      // Out of a hold or the poll: the bed the clock froze under picks up
      // where it stopped. Out of anything else (a cleared answer) it starts
      // again — there is no sting to replay, the question is not new.
      if ((from === 'hold' || from === 'poll') && engine.resumeAll()) break;
      engine.stopAll();
      s.track ??= pickSuspense(s.lastTrack);
      engine.play(s.track, { loop: true });
      break;

    case 'hold':
      engine.pauseAll();
      break;

    case 'poll':
      engine.pauseAll();
      engine.play('suspense-poll', { loop: true });
      break;

    case 'silent':
      engine.stopAll();
      break;

    case 'locked':
      engine.stopAll();
      engine.playThen('lock-answer', 'suspense-locked', { loopNext: true });
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
