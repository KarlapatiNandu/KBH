import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * R14 — Prize Ladder Panel
 *
 * The host's side of the money tree (`assets and references/
 * Price_list_display.png`). Two things are editable, and they are the two
 * things a host actually changes between run-throughs:
 *
 *   how much each rung pays — free text, exactly like a question's prize,
 *     so "7 Crore" and "₹10,000" are both fine and the host types what the
 *     show says.
 *   how many rungs there are — one box. Raising it adds blank rungs at the
 *     top for the host to price; lowering it takes them off the top, which
 *     is the end a shortened ladder loses.
 *
 * Plus the milestone flag: the guaranteed rung, drawn in white on the
 * contestant's ladder. It is a toggle rather than a number because "which
 * rungs are safe" is a decision about the run, not arithmetic.
 *
 * Edits go straight to `prize_ladder` (RLS is open on it, same as
 * questions) and reach the contestant's open ladder through realtime.
 *
 * The panel is not gated on the round being live: the ladder is set up
 * before the show, and a host re-pricing a rung mid-run should not have to
 * end the round to do it.
 *
 * Props:
 *   round — which round's ladder (2 today)
 *   onResult(message, type) — toast callback owned by the parent
 */

// A new rung has to carry something — the column is NOT NULL and the
// contestant's ladder would otherwise show a blank line. An em dash reads
// as "not priced yet" on both screens, and the panel marks it as unset.
const UNSET_LABEL = '—';

const MAX_STAGES = 30;

export default function PrizeLadderPanel({ round = 2, onResult }) {
  const [rungs, setRungs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Set when prize_ladder cannot be read at all — almost always a database
  // that has not run migration_v10 yet.
  const [blocked, setBlocked] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The stage count while the host is typing it: a string, because a
  // half-typed box is a string and turning it into a number on every
  // keystroke fights them.
  const [stageDraft, setStageDraft] = useState('');

  const fetchRungs = useCallback(async () => {
    const { data, error } = await supabase
      .from('prize_ladder')
      .select('*')
      .eq('round', round)
      .order('level');

    if (error) {
      setBlocked(
        /prize_ladder|schema cache|does not exist/i.test(error.message)
          ? 'The prize ladder needs the database migration — run supabase/migration_v10.sql.'
          : `Could not read the prize ladder: ${error.message}`
      );
      setLoaded(true);
      return;
    }

    setBlocked(null);
    setRungs(data || []);
    setLoaded(true);
    // Only while the host has not touched the box, so a re-read never
    // overwrites a count they are half-way through typing.
    setStageDraft((prev) => (prev === '' ? String((data || []).length) : prev));
  }, [round]);

  useEffect(() => {
    fetchRungs();

    const channel = supabase
      .channel(`admin-prize-ladder-${round}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prize_ladder' },
        () => fetchRungs()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRungs, round]);

  const fail = (message, error) => {
    onResult(error?.message ? `${message}: ${error.message}` : message, 'error');
  };

  // Saved on blur rather than per keystroke, same as the contact book: the
  // contestant may have the ladder open, and a price arriving digit by
  // digit is worse than one that lands a moment late.
  const saveLabel = async (rung, value) => {
    const label = value.trim() || UNSET_LABEL;
    if (label === rung.label) return;

    const { error } = await supabase
      .from('prize_ladder')
      .update({ label })
      .eq('id', rung.id);

    if (error) return fail('Could not save the prize', error);
    fetchRungs();
  };

  const toggleMilestone = async (rung) => {
    const { error } = await supabase
      .from('prize_ladder')
      .update({ is_milestone: !rung.is_milestone })
      .eq('id', rung.id);

    if (error) return fail('Could not change the guaranteed rung', error);
    fetchRungs();
  };

  const addStage = async () => {
    setBusy(true);
    const { error } = await supabase
      .from('prize_ladder')
      .insert({ round, level: rungs.length + 1, label: UNSET_LABEL });
    setBusy(false);

    if (error) return fail('Could not add a rung', error);
    setStageDraft(String(rungs.length + 1));
    fetchRungs();
  };

  /**
   * Removing a rung from the middle closes the gap behind it: `level` is
   * the rung's position in the climb, so a ladder numbered 1,2,4,5 is not
   * a ladder with a hole in it — it is a ladder that has lost count, and
   * the contestant's board maps question N onto level N.
   *
   * The shift runs upwards one row at a time. A single bulk update would
   * be neater, but `(round, level)` is unique and checked per row, so
   * moving 4→3 while 3 still exists fails; going in ascending order means
   * the slot below is always empty by the time it is needed.
   */
  const removeStage = async (rung) => {
    if (
      !window.confirm(
        `Remove rung ${rung.level} (${rung.label})? The rungs above it move down one.`
      )
    ) {
      return;
    }

    setBusy(true);

    const { error: deleteError } = await supabase
      .from('prize_ladder')
      .delete()
      .eq('id', rung.id);

    if (deleteError) {
      setBusy(false);
      return fail('Could not remove the rung', deleteError);
    }

    const above = rungs.filter((r) => r.level > rung.level).sort((a, b) => a.level - b.level);
    for (const r of above) {
      const { error } = await supabase
        .from('prize_ladder')
        .update({ level: r.level - 1 })
        .eq('id', r.id);

      if (error) {
        setBusy(false);
        fail('The rung was removed but the ladder could not be renumbered', error);
        fetchRungs();
        return;
      }
    }

    setBusy(false);
    setStageDraft(String(rungs.length - 1));
    onResult(`Rung removed — the ladder now has ${rungs.length - 1} stages`);
    fetchRungs();
  };

  /**
   * Set the number of stages outright. Growing adds blank rungs at the
   * top; shrinking takes them off the top, because the top is the end a
   * shortened ladder loses — nobody shortens a ladder by deleting the
   * ₹1,000 rung out from under the contestant.
   */
  const applyStageCount = async () => {
    const wanted = Math.round(Number(stageDraft));
    if (!Number.isFinite(wanted) || wanted < 1 || wanted > MAX_STAGES) {
      onResult(`Enter a number of stages between 1 and ${MAX_STAGES}`, 'error');
      return;
    }
    if (wanted === rungs.length) return;

    if (wanted < rungs.length) {
      const losing = rungs.filter((r) => r.level > wanted);
      if (
        !window.confirm(
          `Drop the top ${losing.length} rung${losing.length === 1 ? '' : 's'} (${losing
            .map((r) => r.label)
            .join(', ')})?`
        )
      ) {
        return;
      }

      setBusy(true);
      const { error } = await supabase
        .from('prize_ladder')
        .delete()
        .eq('round', round)
        .gt('level', wanted);
      setBusy(false);

      if (error) return fail('Could not shorten the ladder', error);
      onResult(`Ladder set to ${wanted} stages`);
      fetchRungs();
      return;
    }

    const added = [];
    for (let level = rungs.length + 1; level <= wanted; level += 1) {
      added.push({ round, level, label: UNSET_LABEL });
    }

    setBusy(true);
    const { error } = await supabase.from('prize_ladder').insert(added);
    setBusy(false);

    if (error) return fail('Could not lengthen the ladder', error);
    onResult(`Ladder set to ${wanted} stages — price the new rungs`);
    fetchRungs();
  };

  // Top of the ladder first, so the panel reads the way the contestant's
  // ladder does.
  const ordered = [...rungs].sort((a, b) => b.level - a.level);
  const unpriced = rungs.filter((r) => r.label === UNSET_LABEL).length;

  if (!loaded) return null;

  if (blocked) {
    return <div className="plp plp--warning">{blocked}</div>;
  }

  return (
    <div className="plp">
      <button className="plp-head" onClick={() => setOpen((v) => !v)}>
        <span className="plp-caret">{open ? '▾' : '▸'}</span>
        <span className="plp-label">Prize ladder</span>
        <span className="plp-count">
          {rungs.length} stage{rungs.length === 1 ? '' : 's'}
        </span>
        {unpriced > 0 && <span className="plp-warn">{unpriced} unpriced</span>}
      </button>

      {open && (
        <div className="plp-body">
          <div className="plp-stages">
            <label className="plp-stage-field">
              Stages
              <input
                type="number"
                min="1"
                max={MAX_STAGES}
                step="1"
                inputMode="numeric"
                value={stageDraft}
                onChange={(e) => setStageDraft(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              className="plp-go plp-go--quiet"
              onClick={applyStageCount}
              disabled={busy || stageDraft === String(rungs.length)}
            >
              Apply
            </button>
            <p className="plp-note">
              More rungs go on the top of the ladder; fewer come off the top.
            </p>
          </div>

          <div className="plp-list">
            {ordered.length === 0 && (
              <p className="plp-note">No rungs yet — add one below.</p>
            )}

            {ordered.map((rung) => (
              <div
                className={`plp-row ${rung.is_milestone ? 'plp-row--milestone' : ''}`}
                key={rung.id}
              >
                <span className="plp-level">{rung.level}</span>
                <input
                  className={`plp-input ${rung.label === UNSET_LABEL ? 'plp-input--unset' : ''}`}
                  defaultValue={rung.label}
                  // defaultValue is only read on mount, so the input has to
                  // be re-keyed when the row's level changes underneath it
                  // — otherwise a renumbered ladder shows the old prices.
                  key={`${rung.id}:${rung.level}`}
                  placeholder="e.g. ₹10,000"
                  onBlur={(e) => saveLabel(rung, e.target.value)}
                  disabled={busy}
                />
                <button
                  className={`plp-mile ${rung.is_milestone ? 'plp-mile--on' : ''}`}
                  onClick={() => toggleMilestone(rung)}
                  disabled={busy}
                  title={
                    rung.is_milestone
                      ? 'Guaranteed rung — drawn in white on the contestant’s ladder. Tap to clear.'
                      : 'Mark as a guaranteed rung'
                  }
                >
                  ✦
                </button>
                <button
                  className="plp-mini plp-mini--danger"
                  onClick={() => removeStage(rung)}
                  disabled={busy}
                  title="Remove this rung"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button className="plp-add" onClick={addStage} disabled={busy}>
            {busy ? 'Working…' : '+ Add a rung on top'}
          </button>

          <p className="plp-note">
            The contestant opens this from their board. Question N of the round is
            played for rung N, and ✦ marks the guaranteed rungs.
          </p>
        </div>
      )}

      <PrizeLadderPanelStyles />
    </div>
  );
}

function PrizeLadderPanelStyles() {
  return (
    <style>{`
      .plp {
        width: 100%;
        margin-bottom: var(--space-lg);
        border-radius: var(--radius-md);
        border: 1px solid rgba(242,183,5,0.3);
        background: rgba(11,20,64,0.45);
        overflow: hidden;
      }

      .plp--warning {
        padding: var(--space-md);
        border-color: rgba(229,72,77,0.4);
        background: rgba(229,72,77,0.08);
        color: var(--danger-red);
        font-size: 12px;
        line-height: 1.4;
      }

      .plp-head {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        width: 100%;
        padding: var(--space-sm) var(--space-md);
        border: 0;
        background: transparent;
        color: var(--cloud-white);
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }

      .plp-caret { color: var(--pale-gold); }

      .plp-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--pale-gold);
      }

      .plp-count {
        padding: 1px 7px;
        border-radius: var(--radius-pill);
        background: rgba(242,183,5,0.15);
        color: var(--spotlight-gold);
        font-size: 11px;
        font-weight: 600;
      }

      /* A rung with no price on it is not a detail — it is a blank line on
         the contestant's ladder, so it is counted on the closed header. */
      .plp-warn {
        margin-left: auto;
        padding: 1px 7px;
        border-radius: var(--radius-pill);
        background: rgba(232,135,30,0.16);
        color: var(--warning-amber);
        font-size: 11px;
        font-weight: 600;
      }

      .plp-body {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: 0 var(--space-md) var(--space-md);
      }

      .plp-note {
        font-size: 11px;
        line-height: 1.4;
        color: var(--pale-gold);
        margin: 0;
      }

      /* ── Stage count ─────────────────────────────────────── */
      .plp-stages {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-sm);
        padding-bottom: var(--space-sm);
        border-bottom: 1px solid rgba(242,183,5,0.18);
      }

      .plp-stage-field {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--pale-gold);
      }

      .plp-stage-field input {
        width: 68px;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.25);
        background: rgba(4,10,36,0.7);
        color: var(--cloud-white);
        font: inherit;
      }

      .plp-stages .plp-note { flex-basis: 100%; }

      .plp-go {
        padding: 6px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--spotlight-gold);
        background: var(--spotlight-gold);
        color: var(--deep-midnight);
        font-family: 'Poppins', sans-serif;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .plp-go:disabled { opacity: 0.45; cursor: default; }

      .plp-go--quiet {
        border-color: rgba(242,183,5,0.35);
        background: transparent;
        color: var(--pale-gold);
      }

      .plp-go--quiet:hover:not(:disabled) {
        border-color: var(--spotlight-gold);
        color: var(--spotlight-gold);
      }

      /* ── The rungs ───────────────────────────────────────── */
      .plp-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 320px;
        overflow-y: auto;
      }

      .plp-row {
        display: grid;
        grid-template-columns: 26px 1fr 26px 24px;
        align-items: center;
        gap: 6px;
      }

      .plp-level {
        font-family: 'Poppins', sans-serif;
        font-size: 12px;
        font-weight: 700;
        text-align: right;
        color: var(--antique-gold);
      }

      /* White, the way the guaranteed rung reads on the contestant's
         ladder — the two panels must agree at a glance. */
      .plp-row--milestone .plp-level { color: var(--cloud-white); }

      .plp-input {
        width: 100%;
        padding: 5px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(242,183,5,0.2);
        background: rgba(11,20,64,0.7);
        color: var(--cloud-white);
        font-family: 'Poppins', sans-serif;
        font-size: 12px;
        font-weight: 600;
      }

      .plp-input:focus {
        outline: none;
        border-color: var(--spotlight-gold);
      }

      .plp-input--unset {
        border-color: rgba(232,135,30,0.45);
        color: var(--warning-amber);
      }

      .plp-mile {
        width: 26px;
        height: 24px;
        border-radius: 5px;
        border: 1px solid rgba(242,183,5,0.2);
        background: transparent;
        color: rgba(232,217,160,0.45);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }

      .plp-mile--on {
        border-color: var(--champagne-gold);
        background: rgba(247,231,160,0.16);
        color: var(--cloud-white);
      }

      .plp-mini {
        width: 24px;
        height: 24px;
        border-radius: 5px;
        border: 1px solid rgba(242,183,5,0.2);
        background: transparent;
        color: var(--pale-gold);
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
      }

      .plp-mini:disabled, .plp-mile:disabled { opacity: 0.3; cursor: default; }

      .plp-mini--danger { color: var(--danger-red); }

      .plp-add {
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

      .plp-add:hover:not(:disabled) { border-color: var(--spotlight-gold); }
    `}</style>
  );
}
