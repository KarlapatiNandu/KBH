import { parseCsv, mapHeader } from './csv';

/**
 * CSV → question rows, with every complaint the host needs to hear before
 * anything is written. Kept apart from the panel so it stays testable and
 * the component is only UI.
 */

const HEADER_ALIASES = {
  round:       ['round', 'round_no', 'round_number'],
  text:        ['text', 'question', 'question_text'],
  option_a:    ['option_a', 'optiona', 'option_1', 'option1', 'a'],
  option_b:    ['option_b', 'optionb', 'option_2', 'option2', 'b'],
  option_c:    ['option_c', 'optionc', 'option_3', 'option3', 'c'],
  option_d:    ['option_d', 'optiond', 'option_4', 'option4', 'd'],
  correct:     ['correct', 'correct_option', 'answer', 'correct_answer'],
  base_points: ['base_points', 'points', 'score'],
  duration_s:  ['duration_s', 'duration', 'time_s', 'time', 'seconds'],
  prize:       ['prize', 'prize_money'],
};

const REQUIRED = ['round', 'text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct'];

export const TEMPLATE_ROWS = [
  ['round', 'text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'base_points', 'duration_s', 'prize'],
  ['1', 'Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Earth', 'Mars', 'A', '100', '30', ''],
  ['2', 'In 1969, who first set foot on the Moon?', 'Buzz Aldrin', 'Neil Armstrong', 'Yuri Gagarin', 'Michael Collins', 'B', '200', '', '10,000'],
];

/** "A"–"D" or "1"–"4" (1 = the first option) → a 0-based index. */
export function parseCorrect(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  if (/^[A-D]$/.test(v)) return v.charCodeAt(0) - 65;
  if (/^[1-4]$/.test(v)) return Number(v) - 1;
  return null;
}

/** One CSV record → a question row, or a list of complaints about it. */
export function buildRow(cells, index, lineNo) {
  const at = (field) => (index[field] == null ? '' : (cells[index[field]] ?? '').trim());
  const errors = [];

  const roundRaw = at('round');
  const round = Number(roundRaw);
  if (round !== 1 && round !== 2) errors.push(`round must be 1 or 2 (got "${roundRaw || 'blank'}")`);

  const text = at('text');
  if (!text) errors.push('question text is blank');

  const options = ['option_a', 'option_b', 'option_c', 'option_d'].map(at);
  const missing = options.map((o, i) => (o ? null : String.fromCharCode(65 + i))).filter(Boolean);
  if (missing.length) errors.push(`option ${missing.join(', ')} is blank`);

  const correct = parseCorrect(at('correct'));
  if (correct === null) errors.push(`correct must be A–D or 1–4 (got "${at('correct') || 'blank'}")`);

  // Optional columns: blank means "use the default", not "zero".
  const pointsRaw = at('base_points');
  let base_points = 100;
  if (pointsRaw) {
    const n = Number(pointsRaw);
    if (!Number.isFinite(n) || n < 0) errors.push(`base_points must be 0 or more (got "${pointsRaw}")`);
    else base_points = Math.round(n);
  }

  const durationRaw = at('duration_s');
  let duration_ms = null;
  if (durationRaw) {
    const n = Number(durationRaw);
    // The column has a CHECK (duration_ms > 0), so a zero here would be
    // rejected by the database halfway through the insert.
    if (!Number.isFinite(n) || n <= 0) errors.push(`duration_s must be greater than 0 (got "${durationRaw}")`);
    else duration_ms = Math.round(n * 1000);
  }

  return {
    lineNo,
    errors,
    row: errors.length ? null : {
      round,
      text,
      options,
      correct_option: correct,
      base_points,
      duration_ms,
      prize: at('prize') || null,
    },
  };
}

/**
 * Parses a whole file. Returns `{ fatal }` for a problem with the file as a
 * whole, otherwise `{ rows, errors }` — valid questions and per-row failures.
 */
export function parseQuestionCsv(text) {
  const records = parseCsv(text);

  if (records.length === 0) return { fatal: 'That CSV is empty.' };
  if (records.length === 1) return { fatal: 'That CSV has a header but no question rows.' };

  const index = mapHeader(records[0].cells, HEADER_ALIASES);
  const missingCols = REQUIRED.filter((f) => index[f] == null);
  if (missingCols.length) {
    return { fatal: `Missing required column${missingCols.length > 1 ? 's' : ''}: ${missingCols.join(', ')}` };
  }

  const results = records.slice(1).map((r) => buildRow(r.cells, index, r.line));
  return {
    rows: results.filter((r) => r.row).map((r) => r.row),
    errors: results.filter((r) => r.errors.length),
  };
}

/**
 * Appends order_index to each row, continuing each round's existing sequence.
 * `existing` is whatever `select('round, order_index')` returned.
 */
export function withOrderIndex(rows, existing) {
  const nextIndex = {};
  for (const q of existing || []) {
    nextIndex[q.round] = Math.max(nextIndex[q.round] ?? -1, q.order_index);
  }
  return rows.map((r) => {
    const order_index = (nextIndex[r.round] ?? -1) + 1;
    nextIndex[r.round] = order_index;
    return { ...r, order_index };
  });
}
