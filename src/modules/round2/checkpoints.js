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
 * R16 — which rung a question is played for is the question's own
 * `ladder_level`, not its place in the queue: a rung is a pool the host
 * picks from, so several questions share one and most are never asked.
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
 * A rung is cleared when a question played for it was answered correctly,
 * and the climb stops at the first rung that was not: in the hot seat a
 * wrong answer ends the run, so anything above it is not a climb.
 *
 * R16 made this a question about rungs rather than about positions. A rung
 * is a pool of questions now (`ladder_level`), the host asks one of them,
 * and the rest of that pool is never asked — so counting answered questions
 * would stall the climb one rung up from the bottom. A database that has not
 * run migration_v11 has no `ladder_level` at all, and there the queue really
 * was the ladder: that case keeps the old count, unchanged.
 *
 * One rung is stepped over rather than treated as a wall: one with no
 * question filed for it at all. Nothing could have been asked there, and the
 * host's console skips it for the same reason (see admin/tiers.js). It is
 * only ever passed on the strength of a higher rung actually being cleared.
 *
 *   questions — the round's questions, in the order they are served
 *   responses — this participant's rows for round 2, any order
 */
export function clearedLevels(questions, responses) {
  const list = [...(questions || [])].sort((a, b) => a.order_index - b.order_index);
  const responseFor = new Map((responses || []).map((r) => [r.question_id, r]));

  // Pre-R16: no question names a rung, so the queue is the ladder.
  if (!list.some((q) => q.ladder_level != null)) {
    let cleared = 0;
    for (const q of list) {
      const resp = responseFor.get(q.id);
      if (!resp || !resp.is_correct) break;
      cleared += 1;
    }
    return cleared;
  }

  // Whether each rung was bought, and whether it had anything to sell.
  const won = new Set();
  const filled = new Set();
  let top = 0;

  for (const q of list) {
    if (q.ladder_level == null) continue;
    filled.add(q.ladder_level);
    top = Math.max(top, q.ladder_level);
    if (responseFor.get(q.id)?.is_correct) won.add(q.ladder_level);
  }

  let cleared = 0;
  for (let level = 1; level <= top; level += 1) {
    // Nothing written for this rung — not a wall, but not a rung they can be
    // credited with either until something above it is cleared.
    if (!filled.has(level)) continue;
    if (!won.has(level)) break;
    cleared = level;
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
