import kbcIntro from '../../assets/sounds/kbc-intro.mp3';
import questionSting from '../../assets/sounds/question-sting.mp3';
import suspenseQuestionA from '../../assets/sounds/suspense-question-a.mp3';
import suspenseQuestionB from '../../assets/sounds/suspense-question-b.mp3';
import suspensePoll from '../../assets/sounds/suspense-poll.mp3';
import lockAnswer from '../../assets/sounds/lock-answer.mp3';
import suspenseLocked from '../../assets/sounds/suspense-locked.mp3';
import rightAnswer from '../../assets/sounds/right-answer.mp3';
import wrongAnswer from '../../assets/sounds/wrong-answer.mp3';

/**
 * R17 — the sound catalog. One entry per clip; the soundboard's buttons and
 * the engine's element pool both read from here, so adding a clip is one
 * line. `seconds` is only for the label on the button.
 *
 * The sources live in `assets and references/sound_effects/` under their
 * original names. They are copied here with clean ones because two of those
 * have a trailing space before the extension.
 */
/**
 * R19 — `music: [start, end]`, in seconds: where the sound actually is inside
 * the file. These clips were cut with up to a second of digital silence on
 * the front — `suspense-question-a` does not make a sound until 0.85 s in —
 * and several carry some on the back as well. The engine plays from `start`,
 * a loop goes back to `start` when it reaches `end`, and a chained clip hands
 * over at `end` rather than waiting out the file (soundEngine.js). Without
 * it, every loop of a bed drops the room into a second of nothing.
 *
 * Measured with `silencedetect=noise=-50dB`. `end` sits a frame or two inside
 * the last of the sound where the music runs to the end of the file, so the
 * loop's seek always lands while the clip is still playing; where the file
 * has a silent tail it sits in that silence, and nothing is cut.
 *
 * `question-sting` is the exception: its own lead-in is left alone (start 0),
 * because the pause before the sting lands is the sting.
 */
export const SOUNDS = [
  { id: 'kbc-intro', label: 'KBC intro', group: 'Show', url: kbcIntro, seconds: 23, music: [0.06, 22.61] },

  { id: 'question-sting', label: 'Question sting', group: 'Question', url: questionSting, seconds: 5, music: [0, 4.57] },
  { id: 'suspense-question-a', label: 'Suspense A', group: 'Question', url: suspenseQuestionA, seconds: 14, music: [0.84, 13.92] },
  { id: 'suspense-question-b', label: 'Suspense B', group: 'Question', url: suspenseQuestionB, seconds: 18, music: [0, 17.92] },

  { id: 'suspense-poll', label: 'Audience poll suspense', group: 'Lifeline', url: suspensePoll, seconds: 18, music: [0.06, 17.92] },

  { id: 'lock-answer', label: 'Lock the answer', group: 'Answer', url: lockAnswer, seconds: 3, music: [1.12, 2.82] },
  { id: 'suspense-locked', label: 'Suspense after lock', group: 'Answer', url: suspenseLocked, seconds: 14, music: [0.40, 13.90] },
  { id: 'right-answer', label: 'Right answer', group: 'Answer', url: rightAnswer, seconds: 11, music: [0.22, 10.45] },
  { id: 'wrong-answer', label: 'Wrong answer', group: 'Answer', url: wrongAnswer, seconds: 3, music: [0.16, 3.28] },
];

export const SOUND_GROUPS = ['Show', 'Question', 'Lifeline', 'Answer'];

export const SOUND_BY_ID = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

// The two beds that play under a live question; one is picked per serve.
export const QUESTION_SUSPENSE = ['suspense-question-a', 'suspense-question-b'];
