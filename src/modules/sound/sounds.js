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
export const SOUNDS = [
  { id: 'kbc-intro', label: 'KBC intro', group: 'Show', url: kbcIntro, seconds: 23 },

  { id: 'question-sting', label: 'Question sting', group: 'Question', url: questionSting, seconds: 5 },
  { id: 'suspense-question-a', label: 'Suspense A', group: 'Question', url: suspenseQuestionA, seconds: 14 },
  { id: 'suspense-question-b', label: 'Suspense B', group: 'Question', url: suspenseQuestionB, seconds: 18 },

  { id: 'suspense-poll', label: 'Audience poll suspense', group: 'Lifeline', url: suspensePoll, seconds: 18 },

  { id: 'lock-answer', label: 'Lock the answer', group: 'Answer', url: lockAnswer, seconds: 3 },
  { id: 'suspense-locked', label: 'Suspense after lock', group: 'Answer', url: suspenseLocked, seconds: 14 },
  { id: 'right-answer', label: 'Right answer', group: 'Answer', url: rightAnswer, seconds: 11 },
  { id: 'wrong-answer', label: 'Wrong answer', group: 'Answer', url: wrongAnswer, seconds: 3 },
];

export const SOUND_GROUPS = ['Show', 'Question', 'Lifeline', 'Answer'];

export const SOUND_BY_ID = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

// The two beds that play under a live question; one is picked per serve.
export const QUESTION_SUSPENSE = ['suspense-question-a', 'suspense-question-b'];
