/**
 * R10 — Lifelines, shared definitions
 *
 * One place for the four lifelines' keys, labels and behaviour, so the
 * contestant's screen and the host's console can never drift on what a
 * lifeline is called or what it does. The badge artwork lives next door
 * in LifelineIcon.jsx.
 *
 * The keys match `lifeline_state.key` in the database exactly.
 */

export const LIFELINE_KEYS = ['audience_poll', 'fifty_fifty', 'call_expert', 'phone_friend'];

export const LIFELINES = [
  {
    key: 'audience_poll',
    label: 'Audience Poll',
    // The room votes; the host counts it in and ending the poll publishes
    // the bar chart on the contestant's board. (R11)
    hint: 'The host counts the room in, then ends the poll to show the chart.',
  },
  {
    key: 'fifty_fifty',
    label: '50:50',
    // R13 — picking it stops the contestant's clock; the strike starts it.
    hint: 'Two wrong options struck off by the host. The strike restarts the clock.',
  },
  {
    key: 'call_expert',
    label: 'Call an Expert',
    hint: 'The clock stops from the pick until the call time runs out.',
  },
  {
    key: 'phone_friend',
    label: 'Phone a Friend',
    hint: 'The clock stops from the pick until the call time runs out.',
  },
];

/**
 * R11 — audience poll counts → whole percentages that still add up to 100.
 *
 * Lives here rather than in the chart because the host's console previews
 * the same split while they are typing the tally, and a console that
 * rounds differently from the board is worse than no preview at all.
 *
 * Rounding each share on its own gives 33/33/33 for a three-way split and
 * leaves 1% unaccounted for on screen, which is exactly the sort of thing
 * an audience notices. Largest remainder hands the leftovers to the options
 * with the biggest fractions, so the row always totals 100.
 */
export function votesToPercents(votes) {
  const counts = (votes || []).map((v) => Math.max(0, Number(v) || 0));
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total <= 0) return counts.map(() => 0);

  const exact = counts.map((c) => (c * 100) / total);
  const percents = exact.map(Math.floor);
  let leftover = 100 - percents.reduce((sum, p) => sum + p, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < byRemainder.length && leftover > 0; i += 1, leftover -= 1) {
    percents[byRemainder[i].index] += 1;
  }

  return percents;
}

/** The two lifelines that freeze the question clock and run one of their own. */
export const PHONE_LIFELINES = ['call_expert', 'phone_friend'];

export const isPhoneLifeline = (key) => PHONE_LIFELINES.includes(key);

/** Which address book each phone lifeline dials from (`lifeline_contacts.kind`). */
export const CONTACT_KIND = {
  call_expert: 'expert',
  phone_friend: 'friend',
};

export const CONTACT_KINDS = [
  { kind: 'expert', label: 'Experts', lifelineKey: 'call_expert' },
  { kind: 'friend', label: 'Friends', lifelineKey: 'phone_friend' },
];

/** Used when the host has not set a length for this lifeline. */
export const DEFAULT_LIFELINE_DURATION_MS = 30000;

export const lifelineLabel = (key) =>
  LIFELINES.find((l) => l.key === key)?.label || key;
