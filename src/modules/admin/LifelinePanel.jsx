import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import LifelineIcon from '../round2/LifelineIcon';
import {
  LIFELINES,
  CONTACT_KINDS,
  DEFAULT_LIFELINE_DURATION_MS,
  isPhoneLifeline,
  lifelineLabel,
  votesToPercents,
} from '../round2/lifelines';

/**
 * R10 — Lifeline Panel
 *
 * The host plays all four lifelines from here, the same way they lock in the
 * answer (R7) and reveal it (R9) — the contestant's screen only ever mirrors
 * what happens on this panel.
 *
 *   Audience Poll — starting it puts the LIVE banner on the contestant's
 *     screen while the room votes. The host types the tally in here, one
 *     count per option, and ending the poll publishes it as the bar chart
 *     (R11). Counts, not percentages: the chart works out the split, so a
 *     miscounted option can be fixed on its own — including after the chart
 *     is already up, which is what "Update result on screen" is for.
 *   50:50 — the host picks which two wrong options to strike. There is no
 *     automatic choice: on the show the two that go are picked for the
 *     moment. The RPC refuses to strike the correct answer.
 *   Call an Expert / Phone a Friend — freezes the question's countdown and
 *     puts the phone up with its contact list and a countdown of its own.
 *     The contact list is editable while the call is live and the change
 *     lands on the contestant's screen through realtime.
 *
 * Props:
 *   roundState — the round 2 round_state row
 *   questions  — round 2 questions incl. options + correct_option
 *   onResult(message, type) — toast callback owned by the parent
 */

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function LifelinePanel({ roundState, questions, onResult }) {
  const [lifelines, setLifelines] = useState([]);
  const [contacts, setContacts] = useState([]);
  // Set when lifeline_state cannot be read at all — almost always a database
  // that has not run migration_v7 yet.
  const [blocked, setBlocked] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  // 50:50 — the two the host has ticked, before they commit them.
  const [striking, setStriking] = useState([]);
  // Audience poll — what the host has typed into the vote boxes so far,
  // keyed by option index. Strings, because a half-typed box is a string
  // and turning it into a number on every keystroke fights the host. (R11)
  const [pollVotes, setPollVotes] = useState({});
  // Call length in seconds, per phone lifeline, while the host is setting it.
  const [durations, setDurations] = useState({});

  const isLive = roundState?.status === 'active';
  const liveQuestion = isLive
    ? questions.find((q) => q.order_index === roundState.current_question_index) || null
    : null;

  const fetchLifelines = useCallback(async () => {
    const { data, error } = await supabase
      .from('lifeline_state')
      .select('*')
      .eq('round', 2);

    if (error) {
      setBlocked(
        /lifeline_state|schema cache|does not exist/i.test(error.message)
          ? 'Lifelines need the database migration — run supabase/migration_v7.sql, then re-run supabase/rpcs.sql.'
          : `Could not read lifelines: ${error.message}`
      );
      return;
    }

    setBlocked(null);
    setLifelines(data || []);

    // A tally already in the database seeds the boxes — a console reopened
    // mid-question has to come back with the numbers it had. Only while the
    // host has typed nothing, so a re-read never overwrites a box in use.
    setPollVotes((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const poll = (data || []).find((l) => l.key === 'audience_poll');
      if (!Array.isArray(poll?.poll_votes)) return prev;
      return Object.fromEntries(poll.poll_votes.map((v, i) => [i, String(v)]));
    });
    // Seed the duration inputs from whatever the host last used.
    setDurations((prev) => {
      const next = { ...prev };
      (data || []).forEach((l) => {
        if (next[l.key] === undefined && isPhoneLifeline(l.key)) {
          next[l.key] = String(Math.round((l.duration_ms || DEFAULT_LIFELINE_DURATION_MS) / 1000));
        }
      });
      return next;
    });
  }, []);

  const fetchContacts = useCallback(async () => {
    const { data, error } = await supabase
      .from('lifeline_contacts')
      .select('*')
      .order('sort_order')
      .order('created_at');

    if (!error) setContacts(data || []);
  }, []);

  useEffect(() => {
    fetchLifelines();
    fetchContacts();

    const channel = supabase
      .channel('admin-lifeline-panel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lifeline_state' },
        () => fetchLifelines()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lifeline_contacts' },
        () => fetchContacts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLifelines, fetchContacts]);

  // A new serve is a clean slate for the 50:50 checkboxes and the poll's
  // vote boxes alike: both belong to the question that just left the board.
  useEffect(() => {
    setStriking([]);
    setPollVotes({});
  }, [roundState?.question_started_at]);

  const statusOf = (key) =>
    lifelines.find((l) => l.key === key)?.status || 'available';

  const run = async (key, fn) => {
    setBusyKey(key);
    const { data, error } = await fn();
    setBusyKey(null);
    fetchLifelines();

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Lifeline action failed', 'error');
      return false;
    }
    return true;
  };

  const activate = async (key) => {
    const seconds = Number(durations[key]);
    const durationMs = isPhoneLifeline(key) && seconds > 0 ? Math.round(seconds * 1000) : null;

    const ok = await run(key, () =>
      supabase.rpc('activate_lifeline', { p_key: key, p_duration_ms: durationMs })
    );
    if (ok) {
      onResult(
        isPhoneLifeline(key)
          ? `${lifelineLabel(key)} is live — the question clock is paused`
          : `${lifelineLabel(key)} is live on the contestant's screen`
      );
    }
  };

  const end = async (key) => {
    const ok = await run(key, () => supabase.rpc('end_lifeline', { p_key: key }));
    if (ok) {
      onResult(
        isPhoneLifeline(key)
          ? `${lifelineLabel(key)} ended — the question clock is running again`
          : `${lifelineLabel(key)} ended`
      );
    }
  };

  const applyFiftyFifty = async () => {
    const ok = await run('fifty_fifty', () =>
      supabase.rpc('set_fifty_fifty', {
        p_option_a: striking[0],
        p_option_b: striking[1],
      })
    );
    if (ok) {
      onResult(
        `50:50 — ${OPTION_LABELS[striking[0]]} and ${OPTION_LABELS[striking[1]]} struck off`
      );
      setStriking([]);
    }
  };

  // ── Picking (R12) ──────────────────────────────────────────
  // The contestant names a lifeline and the host marks it: the medallion
  // comes up on their board before anything is actually played. One at a
  // time — picking a second moves the badge rather than showing both.
  const pick = async (key) => {
    const ok = await run(key, () => supabase.rpc('pick_lifeline', { p_key: key }));
    if (ok) onResult(`${lifelineLabel(key)} picked — it is marked on the contestant's board`);
  };

  const clearPick = async (key) => {
    const ok = await run(key, () => supabase.rpc('pick_lifeline', { p_key: null }));
    if (ok) onResult('Pick cleared');
  };

  // ── Audience poll (R11) ────────────────────────────────────
  // The boxes hold whatever the host typed; the RPC wants one number per
  // option, in option order, with the blanks read as nought.
  const pollCounts = () =>
    (liveQuestion?.options || []).map((_, index) =>
      Math.max(0, Math.round(Number(pollVotes[index]) || 0))
    );

  const savePollVotes = async (counts) => {
    const { data, error } = await supabase.rpc('set_poll_votes', { p_votes: counts });
    if (error || !data?.success) {
      onResult(
        /set_poll_votes|schema cache|does not exist/i.test(error?.message || '')
          ? 'The poll result needs the database migration — run supabase/migration_v8.sql, then re-run supabase/rpcs.sql.'
          : error?.message || data?.error || 'Could not save the votes',
        'error'
      );
      return false;
    }
    return true;
  };

  // Ending the poll is the publish: the tally goes in, then the lifeline is
  // spent, and the chart comes up on the contestant's board.
  const endPoll = async () => {
    setBusyKey('audience_poll');
    const counts = pollCounts();
    const total = counts.reduce((sum, c) => sum + c, 0);

    // A poll ended with no tally is a poll with nothing to show, not an
    // error — the host still gets the banner off the contestant's screen.
    const saved = total > 0 ? await savePollVotes(counts) : true;

    if (saved) {
      const { data, error } = await supabase.rpc('end_lifeline', { p_key: 'audience_poll' });
      if (error || !data?.success) {
        onResult(error?.message || data?.error || 'Could not end the poll', 'error');
      } else {
        onResult(
          total > 0
            ? `Poll ended — the result is on the contestant's screen`
            : 'Poll ended — no votes were entered, so there is no chart'
        );
      }
    }

    setBusyKey(null);
    fetchLifelines();
  };

  // A miscount spotted after the chart is up. Same RPC, no second ending.
  const updatePollResult = async () => {
    setBusyKey('audience_poll');
    const ok = await savePollVotes(pollCounts());
    if (ok) onResult('Poll result updated on the contestant\'s screen');
    setBusyKey(null);
    fetchLifelines();
  };

  // Taking the chart back off the contestant's board — and with it the
  // hold on their countdown, which picks up from where it froze.
  const hidePollResult = async () => {
    const ok = await run('audience_poll', () => supabase.rpc('hide_poll_result'));
    if (ok) onResult('Poll result hidden — the question clock is running again');
  };

  const resetAll = async () => {
    const ok = await run('__reset', () => supabase.rpc('reset_lifelines', { p_round: 2 }));
    if (ok) onResult('All four lifelines handed back');
  };

  const toggleStrike = (index) => {
    setStriking((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      // Two at a time: ticking a third drops the oldest, which is quicker
      // than making the host untick one under time pressure.
      return [...prev, index].slice(-2);
    });
  };

  // What the vote boxes currently add up to, and the split the contestant
  // would see — worked out with the chart's own function, so the preview
  // here and the bars there can never disagree by a point. (R11)
  const pollRow = lifelines.find((l) => l.key === 'audience_poll');
  const pollOnLiveQuestion = !!liveQuestion && pollRow?.question_id === liveQuestion.id;
  // The chart is up — and the contestant's clock is held — exactly while the
  // poll is spent, has a tally, and has not been hidden. (R11)
  // A pick belongs to the question it was made on, exactly as the
  // medallion on the contestant's board does. (R12)
  const pickedKey =
    (liveQuestion &&
      lifelines.find((l) => l.picked_at && l.question_id === liveQuestion.id)?.key) ||
    null;

  const pollShowing =
    pollRow?.status === 'used' &&
    Array.isArray(pollRow.poll_votes) &&
    !pollRow.poll_hidden_at;
  const pollDraft = pollCounts();
  const pollTotal = pollDraft.reduce((sum, c) => sum + c, 0);
  const pollPercents = votesToPercents(pollDraft);

  if (!isLive) return null;

  if (blocked) {
    return <div className="llp llp--warning">{blocked}</div>;
  }

  return (
    <div className="llp">
      <div className="llp-head">
        <span className="llp-label">Lifelines</span>
        <button className="llp-reset" onClick={resetAll} disabled={busyKey !== null}>
          Reset all
        </button>
      </div>

      {!liveQuestion && (
        <p className="llp-note">
          No live question — serve one below before playing a lifeline.
        </p>
      )}

      <div className="llp-grid">
        {LIFELINES.map(({ key, label, hint }) => {
          const status = statusOf(key);
          const busy = busyKey === key;

          // A spent poll whose chart is still up is not a spent lifeline as
          // far as the host is concerned: it is holding the contestant's
          // clock, and it is the card they have to come back to. (R11)
          const holding = key === 'audience_poll' && pollShowing;
          // R12 — named by the contestant and marked on their board, but
          // not yet played.
          const picked = pickedKey === key;

          return (
            <div
              className={`llp-card llp-card--${status} ${holding ? 'llp-card--holding' : ''} ${
                picked ? 'llp-card--picked' : ''
              }`}
              key={key}
            >
              <div className="llp-card-head">
                <span className="llp-badge">
                  <LifelineIcon lifelineKey={key} />
                </span>
                <div className="llp-card-title">
                  <strong>{label}</strong>
                  <span
                    className={`llp-status llp-status--${
                      holding || picked ? 'active' : status
                    }`}
                  >
                    {status === 'active'
                      ? 'LIVE'
                      : holding
                        ? 'ON SCREEN'
                        : picked
                          ? 'PICKED'
                          : status.toUpperCase()}
                  </span>
                </div>
              </div>

              <p className="llp-hint">{hint}</p>

              {/* R12 — pick: the contestant names the lifeline, the host
                  marks it, and the medallion comes up on their board a beat
                  before it is actually played. The Audience Poll has none —
                  starting it is already the announcement — and a lifeline
                  already running has nothing left to announce. */}
              {key !== 'audience_poll' && status === 'available' && (
                <button
                  className={`llp-pick ${picked ? 'llp-pick--on' : ''}`}
                  onClick={() => (picked ? clearPick(key) : pick(key))}
                  disabled={busy || !liveQuestion}
                  title={
                    picked
                      ? "Take the medallion back off the board and restart the clock"
                      : "Mark this lifeline on the contestant's board and stop their clock"
                  }
                >
                  {picked ? '● Picked — tap to clear' : 'Pick'}
                </button>
              )}

              {/* R13 — the pick stops the contestant's countdown, so say so
                  here: from the host's side the clock going quiet is the
                  whole point, and the way back out of it is not obvious. */}
              {key !== 'audience_poll' && status === 'available' && picked && (
                <p className="llp-note llp-note--hold">
                  Clock paused. It starts again when you play this — or when you
                  clear the pick.
                </p>
              )}

              {/* 50:50 — the host picks the two to strike, right here against
                  the live question's own options. */}
              {key === 'fifty_fifty' ? (
                status === 'used' ? (
                  <p className="llp-note">Already played.</p>
                ) : (
                  <>
                    <div className="llp-strike-opts">
                      {(liveQuestion?.options || []).map((option, index) => {
                        const isCorrect = index === liveQuestion.correct_option;
                        return (
                          <button
                            key={index}
                            className={`llp-strike ${striking.includes(index) ? 'llp-strike--on' : ''}`}
                            onClick={() => toggleStrike(index)}
                            // The correct answer is never strikeable — the RPC
                            // refuses it too, but the host should not be able
                            // to aim at it in the first place.
                            disabled={isCorrect || busy}
                            title={isCorrect ? 'This is the correct answer' : `Strike ${OPTION_LABELS[index]}`}
                          >
                            <span className="llp-strike-letter">{OPTION_LABELS[index]}</span>
                            <span className="llp-strike-text">{option}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="llp-go"
                      onClick={applyFiftyFifty}
                      disabled={striking.length !== 2 || busy || !liveQuestion}
                    >
                      {busy ? 'Striking…' : `Strike ${striking.length}/2`}
                    </button>
                  </>
                )
              ) : key === 'audience_poll' ? (
                /* Audience Poll — the host counts the room into these boxes
                   and ending the poll is what puts the chart on the
                   contestant's board. (R11) */
                status === 'available' ? (
                  <button
                    className="llp-go"
                    onClick={() => activate(key)}
                    disabled={busy || !liveQuestion}
                  >
                    {busy ? 'Starting…' : 'Start poll'}
                  </button>
                ) : status === 'active' && !pollOnLiveQuestion ? (
                  // The host served the next question with the poll still
                  // running. The tally cannot be saved against a question
                  // that has left the board, but the End button has to stay
                  // reachable or the lifeline is stuck live forever.
                  <>
                    <p className="llp-note">
                      Still running on an earlier question — end it to hand the board back.
                    </p>
                    <button
                      className="llp-go llp-go--end"
                      onClick={() => end('audience_poll')}
                      disabled={busy}
                    >
                      {busy ? 'Ending…' : 'End poll'}
                    </button>
                  </>
                ) : !pollOnLiveQuestion ? (
                  <p className="llp-note">Already played.</p>
                ) : (
                  <>
                    <div className="llp-votes">
                      {(liveQuestion?.options || []).map((option, index) => (
                        <label className="llp-vote" key={index}>
                          <span className="llp-vote-letter">{OPTION_LABELS[index]}</span>
                          <span className="llp-vote-text">{option}</span>
                          <input
                            className="llp-vote-input"
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            placeholder="0"
                            value={pollVotes[index] ?? ''}
                            onChange={(e) =>
                              setPollVotes((prev) => ({ ...prev, [index]: e.target.value }))
                            }
                            // Nothing to change once the chart is off the
                            // board: the boxes stay as a record of what was
                            // shown, but they stop inviting edits.
                            disabled={busy || (status === 'used' && !pollShowing)}
                          />
                          <span className="llp-vote-pct">{pollPercents[index]}%</span>
                        </label>
                      ))}
                    </div>

                    <p className="llp-note">
                      {pollTotal === 0
                        ? 'Enter the count for each option — the chart works out the percentages.'
                        : `${pollTotal} vote${pollTotal === 1 ? '' : 's'} counted`}
                    </p>

                    {status === 'active' ? (
                      <button className="llp-go llp-go--end" onClick={endPoll} disabled={busy}>
                        {busy
                          ? 'Ending…'
                          : pollTotal > 0
                            ? 'End poll & show result'
                            : 'End poll'}
                      </button>
                    ) : pollShowing ? (
                      // The chart is on the board and the contestant's clock
                      // is held. Corrections stay available right up until it
                      // is hidden, which is what hands the clock back.
                      <div className="llp-go-row">
                        <button
                          className="llp-go llp-go--quiet"
                          onClick={updatePollResult}
                          disabled={busy || pollTotal === 0}
                        >
                          {busy ? 'Updating…' : 'Update result'}
                        </button>
                        <button
                          className="llp-go llp-go--end"
                          onClick={hidePollResult}
                          disabled={busy}
                        >
                          {busy ? 'Hiding…' : 'Hide & resume clock'}
                        </button>
                      </div>
                    ) : (
                      <p className="llp-note">
                        Poll closed — the result is off the contestant&rsquo;s screen and
                        their clock is running.
                      </p>
                    )}
                  </>
                )
              ) : (
                <>
                  {/* Call length, for the two lifelines that run a clock. */}
                  {status !== 'used' && (
                    <label className="llp-duration">
                      Call length
                      <input
                        type="number"
                        min="5"
                        max="300"
                        step="5"
                        value={durations[key] ?? ''}
                        onChange={(e) =>
                          setDurations((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        disabled={status === 'active'}
                      />
                      <span>s</span>
                    </label>
                  )}

                  {status === 'used' ? (
                    <p className="llp-note">Already played.</p>
                  ) : status === 'active' ? (
                    <>
                      <button className="llp-go llp-go--end" onClick={() => end(key)} disabled={busy}>
                        {busy ? 'Ending…' : 'End call'}
                      </button>
                      {/* R13 — the call's own clock is what gives the
                          question back. End is for hanging up early, and for
                          handing the lifeline row back afterwards. */}
                      <p className="llp-note llp-note--hold">
                        Their clock restarts by itself when the call time runs out.
                      </p>
                    </>
                  ) : (
                    <button
                      className="llp-go"
                      onClick={() => activate(key)}
                      disabled={busy || !liveQuestion}
                    >
                      {busy ? 'Starting…' : 'Start call'}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* The two phone books. Editable at any time, including mid-call. */}
      <div className="llp-books">
        {CONTACT_KINDS.map(({ kind, label, lifelineKey }) => (
          <ContactBook
            key={kind}
            kind={kind}
            label={label}
            live={statusOf(lifelineKey) === 'active'}
            contacts={contacts.filter((c) => c.kind === kind)}
            onChanged={fetchContacts}
            onResult={onResult}
          />
        ))}
      </div>

      <LifelinePanelStyles />
    </div>
  );
}

/**
 * One address book: the names the contestant sees on the phone when the
 * matching lifeline is played. Edits go straight to `lifeline_contacts`
 * (RLS is open on it, same as questions) and reach the contestant's screen
 * through realtime, phone already on screen or not.
 */
function ContactBook({ kind, label, live, contacts, onChanged, onResult }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const addContact = async () => {
    setAdding(true);
    const nextOrder = contacts.length
      ? Math.max(...contacts.map((c) => c.sort_order)) + 1
      : 0;

    const { error } = await supabase
      .from('lifeline_contacts')
      .insert({ kind, name: 'New contact', sort_order: nextOrder });
    setAdding(false);

    if (error) {
      onResult(`Could not add contact: ${error.message}`, 'error');
      return;
    }
    setOpen(true);
    onChanged();
  };

  // Saved on blur rather than per keystroke: the contestant is looking at
  // this list live, and a half-typed name arriving letter by letter is worse
  // than a name that lands a moment late.
  const saveField = async (contact, field, value) => {
    if ((contact[field] || '') === value) return;

    const { error } = await supabase
      .from('lifeline_contacts')
      .update({ [field]: value || null })
      .eq('id', contact.id);

    if (error) {
      onResult(`Could not save contact: ${error.message}`, 'error');
      return;
    }
    onChanged();
  };

  const removeContact = async (contact) => {
    if (!window.confirm(`Remove ${contact.name} from the ${label.toLowerCase()} list?`)) return;

    const { error } = await supabase.from('lifeline_contacts').delete().eq('id', contact.id);
    if (error) {
      onResult(`Could not remove contact: ${error.message}`, 'error');
      return;
    }
    onChanged();
  };

  // Reorder by swapping sort_order with the neighbour, so the list can be
  // shuffled without renumbering every row.
  const move = async (index, delta) => {
    const a = contacts[index];
    const b = contacts[index + delta];
    if (!a || !b) return;

    const { error } = await supabase
      .from('lifeline_contacts')
      .upsert([
        { ...a, sort_order: b.sort_order },
        { ...b, sort_order: a.sort_order },
      ]);

    if (error) {
      onResult(`Could not reorder: ${error.message}`, 'error');
      return;
    }
    onChanged();
  };

  return (
    <div className={`llb ${live ? 'llb--live' : ''}`}>
      <button className="llb-head" onClick={() => setOpen((v) => !v)}>
        <span className="llb-caret">{open ? '▾' : '▸'}</span>
        <span className="llb-title">{label}</span>
        <span className="llb-count">{contacts.length}</span>
        {live && <span className="llb-live">● on screen now</span>}
      </button>

      {open && (
        <div className="llb-body">
          {contacts.length === 0 && (
            <p className="llp-note">Nobody on this list yet.</p>
          )}

          {contacts.map((contact, index) => (
            <div className="llb-row" key={contact.id}>
              <div className="llb-fields">
                <input
                  className="llb-input llb-input--name"
                  defaultValue={contact.name}
                  placeholder="Name"
                  onBlur={(e) => saveField(contact, 'name', e.target.value.trim())}
                />
                <input
                  className="llb-input"
                  defaultValue={contact.detail || ''}
                  placeholder="Detail — e.g. Physics · IIT-B"
                  onBlur={(e) => saveField(contact, 'detail', e.target.value.trim())}
                />
                <input
                  className="llb-input"
                  defaultValue={contact.avatar_url || ''}
                  placeholder="Photo URL (optional)"
                  onBlur={(e) => saveField(contact, 'avatar_url', e.target.value.trim())}
                />
              </div>
              <div className="llb-row-actions">
                <button
                  className="llb-mini"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="llb-mini"
                  onClick={() => move(index, 1)}
                  disabled={index === contacts.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="llb-mini llb-mini--danger"
                  onClick={() => removeContact(contact)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          <button className="llb-add" onClick={addContact} disabled={adding}>
            {adding ? 'Adding…' : '+ Add contact'}
          </button>
        </div>
      )}
    </div>
  );
}

function LifelinePanelStyles() {
  return (
    <style>{`
      .llp {
        width: 100%;
        margin-bottom: var(--space-lg);
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid rgba(242,183,5,0.3);
        background: rgba(11,20,64,0.45);
      }

      .llp--warning {
        border-color: rgba(229,72,77,0.4);
        background: rgba(229,72,77,0.08);
        color: var(--danger-red);
        font-size: 12px;
        line-height: 1.4;
      }

      .llp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        margin-bottom: var(--space-sm);
      }

      .llp-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--pale-gold);
      }

      .llp-reset {
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.3);
        background: transparent;
        color: var(--pale-gold);
        font-family: 'Inter', sans-serif;
        font-size: 11px;
        cursor: pointer;
      }

      .llp-reset:hover:not(:disabled) { border-color: var(--spotlight-gold); }

      .llp-note {
        font-size: 12px;
        color: var(--pale-gold);
        margin: 0;
      }

      .llp-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-sm);
      }

      .llp-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.2);
        background: rgba(11,20,64,0.6);
      }

      .llp-card--active {
        border-color: var(--spotlight-gold);
        background: rgba(242,183,5,0.1);
      }

      .llp-card--used { opacity: 0.6; }

      /* The poll's chart is on the contestant's board and their countdown is
         frozen behind it. Spent or not, this card carries the weight of a
         live one until the host hides the result. (R11) */
      .llp-note--hold {
        color: var(--spotlight-gold);
      }

      .llp-card--holding {
        opacity: 1;
        border-color: var(--spotlight-gold);
        background: rgba(242,183,5,0.1);
      }

      /* Picked but not yet played: marked on the contestant's board, so it
         is marked here too — a softer light than LIVE, because nothing is
         running yet. (R12) */
      .llp-card--picked {
        border-color: rgba(242,183,5,0.65);
        background: rgba(242,183,5,0.06);
      }

      /* ── Pick (R12) ─────────────────────────────────────────── */
      .llp-pick {
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: var(--radius-pill);
        border: 1px dashed rgba(242,183,5,0.4);
        background: transparent;
        color: var(--pale-gold);
        font-family: 'Inter', sans-serif;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      .llp-pick:hover:not(:disabled) {
        border-color: var(--spotlight-gold);
        color: var(--spotlight-gold);
      }

      .llp-pick:disabled { opacity: 0.4; cursor: default; }

      .llp-pick--on {
        border-style: solid;
        border-color: var(--spotlight-gold);
        background: rgba(242,183,5,0.16);
        color: var(--spotlight-gold);
      }

      .llp-card-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .llp-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 30px;
        border-radius: 50%;
        border: 2px solid var(--antique-gold);
        background: linear-gradient(180deg, #14205c 0%, #0a1138 100%);
        color: var(--spotlight-gold);
      }

      .llp-badge .ll-icon {
        width: 32px;
        height: 20px;
      }

      .llp-card-title {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .llp-card-title strong {
        font-family: 'Poppins', sans-serif;
        font-size: 13px;
        color: var(--cloud-white);
      }

      .llp-status {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--pale-gold);
      }

      .llp-status--active { color: var(--spotlight-gold); }
      .llp-status--used   { color: var(--danger-red); }

      .llp-hint {
        font-size: 11px;
        line-height: 1.4;
        color: var(--pale-gold);
        margin: 0;
      }

      .llp-duration {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--pale-gold);
      }

      .llp-duration input {
        width: 62px;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.25);
        background: rgba(4,10,36,0.7);
        color: var(--cloud-white);
        font: inherit;
      }

      .llp-go {
        margin-top: auto;
        padding: 7px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--spotlight-gold);
        background: var(--spotlight-gold);
        color: var(--deep-midnight);
        font-family: 'Poppins', sans-serif;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .llp-go:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .llp-go:hover:not(:disabled) { filter: brightness(1.08); }

      .llp-go--end {
        border-color: var(--danger-red);
        background: var(--danger-red);
        color: #fff;
      }

      /* Correcting the chart sits beside taking it down, and must not
         compete with it — the host is reaching for one of these under
         time pressure and it is almost always the other one. (R11) */
      .llp-go-row {
        margin-top: auto;
        display: flex;
        gap: 6px;
      }

      .llp-go-row .llp-go {
        margin-top: 0;
        flex: 1;
      }

      .llp-go--quiet {
        border-color: rgba(242,183,5,0.35);
        background: transparent;
        color: var(--pale-gold);
      }

      .llp-go--quiet:hover:not(:disabled) {
        border-color: var(--spotlight-gold);
        color: var(--spotlight-gold);
        filter: none;
      }

      /* ── Audience poll tally (R11) ──────────────────────────── */
      /* One row per option: letter, the option itself, the count box, and
         the share it works out to. The share updates as the host types, so
         a slipped digit shows up here before it shows up on the board. */
      .llp-votes {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .llp-vote {
        display: grid;
        grid-template-columns: 14px 1fr 56px 34px;
        align-items: center;
        gap: 6px;
        font-family: 'Inter', sans-serif;
        font-size: 11px;
        color: var(--cloud-white);
      }

      .llp-vote-letter {
        font-family: 'Poppins', sans-serif;
        font-weight: 700;
        color: var(--spotlight-gold);
      }

      .llp-vote-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--pale-gold);
      }

      .llp-vote-input {
        width: 100%;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.25);
        background: rgba(4,10,36,0.7);
        color: var(--cloud-white);
        font: inherit;
        text-align: right;
      }

      .llp-vote-input:focus {
        outline: none;
        border-color: var(--spotlight-gold);
      }

      .llp-vote-pct {
        font-family: 'Poppins', sans-serif;
        font-size: 11px;
        font-weight: 700;
        text-align: right;
        color: var(--spotlight-gold);
      }

      /* ── 50:50 pickers ──────────────────────────────────────── */
      .llp-strike-opts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }

      .llp-strike {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 7px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.2);
        background: rgba(4,10,36,0.6);
        color: var(--cloud-white);
        font-family: 'Inter', sans-serif;
        font-size: 11px;
        text-align: left;
        cursor: pointer;
        min-width: 0;
      }

      .llp-strike:disabled {
        opacity: 0.35;
        cursor: default;
      }

      .llp-strike--on {
        border-color: var(--danger-red);
        background: rgba(229,72,77,0.18);
        text-decoration: line-through;
      }

      .llp-strike-letter {
        flex-shrink: 0;
        font-family: 'Poppins', sans-serif;
        font-weight: 700;
        color: var(--spotlight-gold);
      }

      .llp-strike-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ── Contact books ──────────────────────────────────────── */
      .llp-books {
        margin-top: var(--space-sm);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .llb {
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.18);
        background: rgba(4,10,36,0.45);
        overflow: hidden;
      }

      .llb--live { border-color: var(--spotlight-gold); }

      .llb-head {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        background: transparent;
        color: var(--cloud-white);
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
      }

      .llb-caret { color: var(--pale-gold); }

      .llb-title { font-weight: 600; }

      .llb-count {
        padding: 1px 7px;
        border-radius: var(--radius-pill);
        background: rgba(242,183,5,0.15);
        color: var(--spotlight-gold);
        font-size: 11px;
        font-weight: 600;
      }

      .llb-live {
        margin-left: auto;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--spotlight-gold);
      }

      .llb-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 10px 10px;
      }

      .llb-row {
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }

      .llb-fields {
        display: grid;
        gap: 4px;
        flex: 1;
        min-width: 0;
      }

      .llb-input {
        width: 100%;
        padding: 5px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.2);
        background: rgba(11,20,64,0.7);
        color: var(--cloud-white);
        font-family: 'Inter', sans-serif;
        font-size: 12px;
      }

      .llb-input:focus {
        outline: none;
        border-color: var(--spotlight-gold);
      }

      .llb-input--name {
        font-family: 'Poppins', sans-serif;
        font-weight: 600;
      }

      .llb-row-actions {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .llb-mini {
        width: 24px;
        height: 22px;
        border-radius: 5px;
        border: 1px solid rgba(242,183,5,0.2);
        background: transparent;
        color: var(--pale-gold);
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
      }

      .llb-mini:disabled { opacity: 0.3; cursor: default; }

      .llb-mini--danger { color: var(--danger-red); }

      .llb-add {
        align-self: flex-start;
        padding: 5px 10px;
        border-radius: var(--radius-sm);
        border: 1px dashed rgba(242,183,5,0.35);
        background: transparent;
        color: var(--pale-gold);
        font-family: 'Inter', sans-serif;
        font-size: 11px;
        cursor: pointer;
      }

      .llb-add:hover:not(:disabled) { border-color: var(--spotlight-gold); }

      @media (max-width: 560px) {
        .llp-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
