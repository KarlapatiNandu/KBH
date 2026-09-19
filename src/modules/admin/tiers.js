/**
 * R16 — Round 2's questions, grouped by the prize rung they are played for.
 *
 * Round 2 used to be a queue: the host served question 1, then 2, then 3,
 * and the ladder was read off that queue's positions. A tier turns each
 * rung into a *pool* — several questions filed at the same `ladder_level`,
 * of which the host asks one. What the contestant climbs is unchanged; what
 * changes is that the host chooses, live, which question buys the rung.
 *
 * The rule that drives the console is one line: the run stands on the
 * lowest rung nobody has answered yet. Answering a tier is what opens the
 * one above it, which is also why nothing here looks at whether the answer
 * was *right* — a wrong answer ends the run (R15), and a run that is over
 * does not need a next tier.
 *
 * Kept apart from the panel so it stays readable on its own, same reason as
 * questionCsv.js.
 */

/**
 * @param questions round 2's questions (any order)
 * @param rungs     prize_ladder rows for round 2 (any order)
 * @param responses the hot seat's round 2 response rows (any order)
 */
export function groupByTier(questions, rungs, responses) {
  const ladder = [...(rungs || [])].sort((a, b) => a.level - b.level);

  const responseByQuestion = new Map();
  for (const r of responses || []) responseByQuestion.set(r.question_id, r);

  const pools = new Map(ladder.map((rung) => [rung.level, []]));

  // A question the ladder has no rung for — never filed, or filed at a rung
  // a shortened ladder has since lost. Not dropped: the host wrote it, and
  // it is theirs to place or ask anyway.
  const unfiled = [];

  for (const q of [...(questions || [])].sort((a, b) => a.order_index - b.order_index)) {
    if (q.ladder_level != null && pools.has(q.ladder_level)) {
      pools.get(q.ladder_level).push(q);
    } else {
      unfiled.push(q);
    }
  }

  const tiers = ladder.map((rung) => {
    const pool = pools.get(rung.level);
    const answered = pool.map((q) => responseByQuestion.get(q.id)).filter(Boolean);

    return {
      key: `tier-${rung.level}`,
      level: rung.level,
      label: rung.label,
      is_milestone: rung.is_milestone,
      questions: pool,
      answered,
      // The verdict on the rung, for the ✓/✗ on a collapsed tier. `wrong`
      // needs every answer in the pool to be wrong, not just one: a tier
      // re-asked after a cleared answer still counts as cleared.
      correct: answered.some((r) => r.is_correct),
      wrong: answered.length > 0 && answered.every((r) => !r.is_correct),
    };
  });

  // An empty rung cannot be answered, so it cannot be the rung the run is
  // waiting on — otherwise a rung nobody has written a question for yet
  // stops the show. It is still called out on the panel.
  const active = tiers.find((t) => t.answered.length === 0 && t.questions.length > 0) || null;

  for (const t of tiers) {
    // `empty` is checked before `locked` and does not depend on where the run
    // is: a rung with nothing written for it is not being withheld from the
    // host, it has nothing to withhold. Reading 🔒 on one sent them looking
    // for a gate instead of for the missing question.
    if (t.answered.length > 0) t.status = 'cleared';
    else if (t.questions.length === 0) t.status = 'empty';
    else if (active && t.level === active.level) t.status = 'active';
    // Everything left is above the rung the run is standing on — `active` is
    // the lowest unanswered rung that has anything to ask.
    else t.status = 'locked';
  }

  return {
    tiers,
    unfiled,
    activeLevel: active ? active.level : null,
    // Rungs with nothing to ask, so the panel can say so before the host
    // finds out by climbing into one mid-show.
    emptyLevels: tiers.filter((t) => t.questions.length === 0).map((t) => t.level),
  };
}

/**
 * Whether the database carries `ladder_level` at all.
 *
 * Read off the rows rather than asked of the schema, the same way
 * HotSeatAnswerPanel tells a missing `revealed_at` from an absent one: a
 * `select('*')` on a database without migration_v11 simply returns rows with
 * no such key. Naming the column in a select or an insert against that
 * database fails the whole statement, so the panels that would name it — the
 * tiered console, and the rung field in QuestionManager — ask this first.
 *
 * An empty questions table says nothing either way, and is treated as
 * migrated: a fresh database should not open with a warning about a column
 * nothing has looked for yet. That guess is harmless where the answer only
 * decides what to draw, and wrong where it decides what to write — so the CSV
 * importer, which writes into a table that may well be empty, probes the
 * column directly instead of asking this.
 */
export function hasRungColumn(questions) {
  const rows = questions || [];
  return rows.length === 0 || rows.some((q) => 'ladder_level' in q);
}

/**
 * Which rung a question is played for, with the pre-R16 fallback: a database
 * that has not run migration_v11 has no `ladder_level` at all, and there the
 * queue *was* the ladder — question N is rung N.
 *
 * @param question the question, or null
 * @param questions the round's questions in served order, for the fallback
 */
export function rungForQuestion(question, questions) {
  if (!question) return null;
  if (question.ladder_level != null) return question.ladder_level;

  const position = (questions || []).findIndex((q) => q.id === question.id);
  return position < 0 ? null : position + 1;
}
