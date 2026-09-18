/**
 * R15 — checkpoints
 *
 * What a contestant walks away with when the run ends.
 *
 * The ladder is a list of stages (PrizeLadderPanel's `plp-stages`), and the
 * host marks some of them as guaranteed — `is_milestone`, the white rungs
 * on the contestant's ladder. Those are the checkpoints: pass one and the
 * money behind it is theirs however badly the rest of the run goes.
 *
 * There is one checkpoint the ladder does not store, and it is the first:
 * zero. A contestant who gets question one wrong has passed nothing, and
 * what they take home is ₹0 — a real result, not a missing one, which is
 * why `checkpointReached` returns level 0 rather than null.
 */

// The floor everybody starts on, below the first rung of the ladder.
export const ZERO_CHECKPOINT = { level: 0, label: '₹0', is_milestone: true };

/**
 * How many rungs the contestant actually cleared.
 *
 * Question N of the run is played for level N, so the count of questions
 * answered correctly *in a row from the bottom* is the rung they are
 * standing on. It stops at the first question that was answered wrong or
 * never answered at all: in the hot seat a wrong answer ends the run, so
 * anything after it is not a climb.
 *
 *   questions — the round's questions, in the order they are served
 *   responses — this participant's rows for round 2, any order
 */
export function clearedLevels(questions, responses) {
  let cleared = 0;

  for (const q of questions || []) {
    const resp = (responses || []).find((r) => r.question_id === q.id);
    if (!resp || !resp.is_correct) break;
    cleared += 1;
  }

  return cleared;
}

/**
 * The highest checkpoint at or below the rungs cleared — the money the
 * contestant keeps. Falls back to the zero floor when they never reached a
 * guaranteed rung.
 *
 *   rungs   — prize_ladder rows for the round, any order
 *   cleared — rungs cleared, from clearedLevels()
 */
export function checkpointReached(rungs, cleared) {
  const ladder = [...(rungs || [])].sort((a, b) => a.level - b.level);
  const top = ladder[ladder.length - 1];

  // Clearing the whole ladder pays its top rung, milestone or not: the run
  // is finished, and there is no rung left above it to fall back from.
  if (top && cleared >= top.level) return top;

  const passed = ladder.filter((r) => r.is_milestone && r.level <= cleared);

  return passed[passed.length - 1] || ZERO_CHECKPOINT;
}
