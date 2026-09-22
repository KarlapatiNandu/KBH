/**
 * R19 — Round 1's three kinds of question, and what an answer to each is.
 *
 * An answer is always an array of 0-based option indices:
 *   single    [2]            — the one option picked
 *   multiple  [0, 3]         — the set picked, sorted
 *   order     [1, 3, 0, 2]   — every option, in the sequence given
 *
 * This mirrors round1_normalize_answer() in the database, which is what the
 * server actually scores against. Everything here is for display and for
 * deciding when an answer is complete enough to lock in.
 */

export const QUESTION_TYPES = {
  single: {
    label: 'Single correct',
    short: 'Single',
    hint: null,
  },
  multiple: {
    label: 'Multiple correct',
    short: 'Multiple',
    hint: 'Select every correct option, then lock in.',
  },
  order: {
    label: 'Choose the right order',
    short: 'Order',
    hint: 'Tap the options in the right order, then lock in.',
  },
};

export const TYPE_KEYS = Object.keys(QUESTION_TYPES);

export const optionLabel = (index) => String.fromCharCode(65 + index);

export const typeOf = (question) => question?.question_type || 'single';

/** The canonical form of an answer — the set sorted for multiple-correct. */
export function normalizeAnswer(type, answer) {
  if (!Array.isArray(answer)) return null;
  return type === 'multiple' ? [...answer].sort((a, b) => a - b) : [...answer];
}

/** Whether an answer can be locked in (or saved as the key) yet. */
export function isAnswerComplete(type, answer, optionCount) {
  if (!Array.isArray(answer) || answer.length === 0) return false;
  if (new Set(answer).size !== answer.length) return false;
  if (answer.some((i) => !Number.isInteger(i) || i < 0 || i >= optionCount)) return false;
  if (type === 'single') return answer.length === 1;
  if (type === 'order') return answer.length === optionCount;
  return true;
}

export function answersEqual(type, a, b) {
  const x = normalizeAnswer(type, a);
  const y = normalizeAnswer(type, b);
  return !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);
}

/** "B", "A, C" or "B → D → A → C". */
export function formatAnswer(type, answer) {
  if (!Array.isArray(answer) || answer.length === 0) return '—';
  return answer.map(optionLabel).join(type === 'order' ? ' → ' : ', ');
}

/**
 * A stored response's answer. Responses recorded before R19 carry only
 * `selected_option`.
 */
export function responseAnswer(response) {
  if (!response) return null;
  if (Array.isArray(response.answer)) return response.answer;
  return response.selected_option != null ? [response.selected_option] : null;
}
