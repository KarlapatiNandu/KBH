import { parseCsv, mapHeader } from './csv';
import { isAnswerComplete, normalizeAnswer } from '../round1/answers';

/**
 * CSV → question rows, with every complaint the host needs to hear before
 * anything is written. Kept apart from the panel so it stays testable and
 * the component is only UI.
 */

const HEADER_ALIASES = {
  round:       ['round', 'round_no', 'round_number'],
  // R19 — Round 1's question type. Blank is single-correct.
  type:        ['type', 'question_type', 'kind'],
  text:        ['text', 'question', 'question_text'],
  option_a:    ['option_a', 'optiona', 'option_1', 'option1', 'a'],
  option_b:    ['option_b', 'optionb', 'option_2', 'option2', 'b'],
  option_c:    ['option_c', 'optionc', 'option_3', 'option3', 'c'],
  option_d:    ['option_d', 'optiond', 'option_4', 'option4', 'd'],
  correct:     ['correct', 'correct_option', 'answer', 'correct_answer'],
  base_points: ['base_points', 'points', 'score'],
  duration_s:  ['duration_s', 'duration', 'time_s', 'time', 'seconds'],
  prize:       ['prize', 'prize_money'],
  // R16 — which prize rung a round 2 question is played for. "tier" and
  // "level" are what a host writing the spreadsheet actually types.
  ladder_level: ['ladder_level', 'rung', 'tier', 'level', 'prize_level'],
};

const REQUIRED = ['round', 'text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct'];

export const TEMPLATE_ROWS = [
  ['round', 'type', 'text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'base_points', 'duration_s', 'prize', 'ladder_level'],
  // One round 1 row of each type (R19), since `correct` reads differently
  // for each: one letter, every correct letter, or the letters in order.
  ['1', 'single', 'Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Earth', 'Mars', 'A', '100', '30', '', ''],
  ['1', 'multiple', 'Which of these are prime numbers?', '2', '9', '13', '21', 'A,C', '100', '30', '', ''],
  ['1', 'order', 'Arrange from closest to farthest from the Sun.', 'Earth', 'Mercury', 'Mars', 'Venus', 'B>D>A>C', '100', '30', '', ''],
  // Two round 2 rows on the same rung, because that is the thing about the
  // column a host cannot guess from its name: a rung is a pool to pick from.
  ['2', '', 'In 1969, who first set foot on the Moon?', 'Buzz Aldrin', 'Neil Armstrong', 'Yuri Gagarin', 'Michael Collins', 'B', '200', '', '10,000', '3'],
  ['2', '', 'Which ocean is the deepest?', 'Atlantic', 'Indian', 'Pacific', 'Arctic', 'C', '200', '', '10,000', '3'],
];

// R19 — what a host might type in the `type` column, spaces and dashes
// already turned into underscores.
const TYPE_ALIASES = {
  single:   ['', 'single', 'single_correct', 'scq', 'one'],
  multiple: ['multiple', 'multi', 'multiple_correct', 'mcq', 'many'],
  order:    ['order', 'ordering', 'sequence', 'sort', 'choose_the_right_order', 'right_order'],
};

export function parseType(raw) {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.keys(TYPE_ALIASES).find((t) => TYPE_ALIASES[t].includes(v)) || null;
}

/**
 * R19 — a Round 1 answer key: "A,C", "A C", "AC", "B>D>A>C", "2,4,1,3"…
 * Letters or 1-based numbers, separated by anything that is not one.
 * Returns option indices in the order written, or null if a piece is not an
 * option.
 */
export function parseAnswerKey(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!v) return null;
  // Anything that is not a letter or digit separates; a piece that is not an
  // option ("E", "X") fails the whole key rather than being dropped.
  let tokens = v.split(/[^A-Z0-9]+/).filter(Boolean);
  // "ACD" — letters run together with no separator.
  if (tokens.length === 1 && /^[A-D]{2,}$/.test(tokens[0])) tokens = tokens[0].split('');
  const indices = tokens.map(parseCorrect);
  return indices.length === 0 || indices.some((i) => i === null) ? null : indices;
}

/** "A"–"D" or "1"–"4" (1 = the first option) → a 0-based index. */
export function parseCorrect(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  if (/^[A-D]$/.test(v)) return v.charCodeAt(0) - 65;
  if (/^[1-4]$/.test(v)) return Number(v) - 1;
  return null;
}

/**
 * One CSV record → a question row, or a list of complaints about it.
 *
 * Complaints come in two kinds. An `errors` entry means the row cannot be
 * turned into a question and blocks the whole import — nothing is written
 * until the host fixes the file. A `warnings` entry means the row imports
 * fine but not the way the host probably meant it: a value that will be
 * ignored, or a question the run will never reach. Refusing an entire import
 * over one of those would be worse than saying so and letting it through.
 */
export function buildRow(cells, index, lineNo) {
  const at = (field) => (index[field] == null ? '' : (cells[index[field]] ?? '').trim());
  const errors = [];
  const warnings = [];

  const roundRaw = at('round');
  const round = Number(roundRaw);
  if (round !== 1 && round !== 2) errors.push(`round must be 1 or 2 (got "${roundRaw || 'blank'}")`);

  const text = at('text');
  if (!text) errors.push('question text is blank');

  const options = ['option_a', 'option_b', 'option_c', 'option_d'].map(at);
  const missing = options.map((o, i) => (o ? null : String.fromCharCode(65 + i))).filter(Boolean);
  if (missing.length) errors.push(`option ${missing.join(', ')} is blank`);

  // R19 — Round 1 has three kinds of question; Round 2 only the one, because
  // its lifelines (50:50, the audience poll) assume a single right answer.
  const typeRaw = at('type');
  const question_type = parseType(typeRaw);
  if (question_type === null) {
    errors.push(`type must be single, multiple or order (got "${typeRaw}")`);
  } else if (round === 2 && question_type !== 'single') {
    errors.push(`round 2 questions are single-correct only (got type "${typeRaw}")`);
  }

  let correct = null;
  let correct_answer = null;
  if (round === 1 && question_type) {
    const key = parseAnswerKey(at('correct'));
    if (key && isAnswerComplete(question_type, key, options.length)) {
      correct_answer = normalizeAnswer(question_type, key);
    } else {
      errors.push({
        single:   `correct must be A–D or 1–4 (got "${at('correct') || 'blank'}")`,
        multiple: `correct must list every correct option, e.g. "A,C" (got "${at('correct') || 'blank'}")`,
        order:    `correct must give all four options in order, e.g. "B>D>A>C" (got "${at('correct') || 'blank'}")`,
      }[question_type]);
    }
  } else {
    correct = parseCorrect(at('correct'));
    if (correct === null) errors.push(`correct must be A–D or 1–4 (got "${at('correct') || 'blank'}")`);
  }

  if (round === 1 && at('prize')) {
    warnings.push('prize ignored — round 1 has no prizes');
  }

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

  // R16 — which prize rung the question is played for. Blank means "not on
  // the ladder", which is a real answer rather than a missing one.
  //
  // Not checked against the ladder's height here: this function does not know
  // how tall the ladder is, and should not — the importer compares the file to
  // the real ladder and says so in the preview (summariseRungs).
  const rungRaw = at('ladder_level');
  let ladder_level = null;
  if (rungRaw) {
    const n = Number(rungRaw);
    if (!Number.isInteger(n) || n < 1) {
      errors.push(`ladder_level must be a whole number of 1 or more (got "${rungRaw}")`);
    } else if (round === 2) {
      ladder_level = n;
    } else {
      // Dropped rather than stored, because round 1 has no ladder to be on —
      // but said out loud. A host who filled the column for every row is
      // entitled to know half of it went nowhere.
      warnings.push(`ladder_level ${n} ignored — round 1 has no prize ladder`);
    }
  } else if (round === 2 && index.ladder_level != null) {
    // The file has the column and left this row's cell empty. The question
    // imports, but the run will never reach it until a rung is set.
    warnings.push('no ladder_level — this round 2 question is not on the ladder, so the run never reaches it');
  }

  // R19 — each round's row carries only the columns its own table has.
  let row = null;
  if (!errors.length) {
    row = round === 1
      ? { round, question_type, text, options, correct_answer, base_points, duration_ms }
      : {
          round,
          text,
          options,
          correct_option: correct,
          base_points,
          duration_ms,
          prize: at('prize') || null,
          ladder_level,
        };
  }

  return { lineNo, errors, warnings, row };
}

/**
 * The same warning on thirty rows is one thing the host needs to fix, not
 * thirty — so identical messages collapse into a line that carries the count
 * and the first few line numbers. Enough to find it in the spreadsheet,
 * short enough to read.
 */
function collapseWarnings(results) {
  const byMessage = new Map();

  for (const r of results) {
    for (const message of r.warnings || []) {
      if (!byMessage.has(message)) byMessage.set(message, []);
      byMessage.get(message).push(r.lineNo);
    }
  }

  return [...byMessage.entries()].map(([message, lines]) => {
    const shown = lines.slice(0, 5).join(', ');
    const rest = lines.length > 5 ? ` and ${lines.length - 5} more` : '';
    return lines.length === 1
      ? `Line ${lines[0]} — ${message}`
      : `${lines.length} rows — ${message} (lines ${shown}${rest})`;
  });
}

/**
 * Parses a whole file. Returns `{ fatal }` for a problem with the file as a
 * whole, otherwise `{ rows, errors, warnings }` — valid questions, per-row
 * failures that block the import, and things the host should know but that do
 * not justify refusing the file.
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
  const rows = results.filter((r) => r.row).map((r) => r.row);
  const warnings = collapseWarnings(results);

  // A file written before R16 has no rung column at all. Its round 1 half is
  // unaffected, but every round 2 question in it lands off the ladder — which
  // is the whole file being imported into a round that will never ask it. Said
  // once, about the file, rather than once per row.
  const round2Count = rows.filter((r) => r.round === 2).length;
  if (index.ladder_level == null && round2Count > 0) {
    warnings.unshift(
      `No ladder_level column, so all ${round2Count} round 2 question` +
      `${round2Count === 1 ? '' : 's'} import off the prize ladder and the run ` +
      `never reaches them. Add a ladder_level column (or set each rung afterwards ` +
      `in the Questions tab).`
    );
  }

  return { rows, errors: results.filter((r) => r.errors.length), warnings };
}

/**
 * R16 — what the import would do to the prize ladder.
 *
 * A bulk import is the one moment a host files a whole run's worth of
 * questions at once, and the mistake it invites is arithmetic: a rung left
 * with nothing to ask, or a rung above the top of a ladder that was never
 * lengthened. Both are invisible in a twenty-row preview table and obvious in
 * a per-rung count, so the preview shows the count.
 *
 *   rows   — the parsed round 2 rows about to be written
 *   rungs  — prize_ladder rows for round 2 (`{ level, label }`, any order)
 *   onLadder — the ladder_level of every round 2 question ALREADY in the
 *              table, so "still has nothing" means still, not just "not in
 *              this file"
 */
export function summariseRungs(rows, rungs, onLadder) {
  const ladder = [...(rungs || [])].sort((a, b) => a.level - b.level);
  const top = ladder.length ? ladder[ladder.length - 1].level : 0;

  const incoming = new Map();
  let unfiled = 0;
  const aboveLadder = new Set();

  for (const r of rows || []) {
    if (r.round !== 2) continue;
    if (r.ladder_level == null) { unfiled += 1; continue; }
    incoming.set(r.ladder_level, (incoming.get(r.ladder_level) || 0) + 1);
    if (r.ladder_level > top) aboveLadder.add(r.ladder_level);
  }

  const already = new Map();
  for (const level of onLadder || []) {
    if (level == null) continue;
    already.set(level, (already.get(level) || 0) + 1);
  }

  const perRung = ladder.map((rung) => ({
    level: rung.level,
    label: rung.label,
    incoming: incoming.get(rung.level) || 0,
    existing: already.get(rung.level) || 0,
  }));

  return {
    perRung,
    // Rungs that will still have no question to ask once this import lands.
    emptyAfter: perRung.filter((r) => r.incoming + r.existing === 0).map((r) => r.level),
    // Rungs the file names that the ladder does not have. Not an error: the
    // ladder is the host's to lengthen, and the fix may be to add rungs
    // rather than to renumber the file.
    aboveLadder: [...aboveLadder].sort((a, b) => a - b),
    unfiled,
    top,
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
