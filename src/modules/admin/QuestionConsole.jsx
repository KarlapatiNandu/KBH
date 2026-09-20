import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * R5 — Question Console
 *
 * Lets the host drive the round by hand: pick any question and push it live,
 * in any order, at any point. Serving a question turns manual mode on, which
 * stops participant clients auto-advancing past whatever the host just served.
 *
 * R16 — Round 2 is not a queue any more. Pass `tiers` (from tiers.js) and the
 * console lists the questions grouped by the prize rung they are played for,
 * one pool per rung, with only the rung the run is standing on open for
 * serving. Answering a tier opens the one above it. Round 1 passes no `tiers`
 * and gets the flat list it has always had: it is one synchronized race down
 * a fixed order, and there is no ladder in it to group by.
 *
 * R18 — above the first checkpoint a question is served alone: the contestant
 * sees only the question, and the options and clock wait for the host's
 * **Reveal options** (HotSeatAnswerPanel). Which questions that covers is
 * the ladder's doing — every rung above the first guaranteed one — and the
 * Options control in the toolbar overrides it for the next serve only, then
 * falls back to the rule, so a rehearsal override cannot be left on into the
 * show.
 *
 * Serving out of turn is still allowed — it asks first. The host is the one
 * in the room, and a tier gate that cannot be overridden is a gate that
 * strands a show.
 *
 * Props:
 *   round      — 1 | 2
 *   roundState — the round_state row (may be null while loading)
 *   questions  — this round's questions, ordered by order_index
 *   tiers      — groupByTier() output, or null for the flat list
 *   onResult(message, type) — toast callback owned by the parent
 *   onChanged() — refetch hint for the parent after a write
 */

// `openKey` holds a tier's key, or one of these two. Kept as one piece of
// state rather than an id plus a boolean because the three cases are
// exclusive: the host has opened a tier, closed them all, or said nothing
// and is following the run.
const FOLLOW_RUN = null;
const ALL_CLOSED = '__closed__';

export default function QuestionConsole({ round, roundState, questions, tiers = null, onResult, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [clearOnServe, setClearOnServe] = useState(false);
  // R18 — 'auto' follows the rung rule; the other two force this one serve.
  const [revealMode, setRevealMode] = useState('auto');
  // Which tier the host has opened by hand. null means "follow the run" —
  // the tier it is standing on, which is what they want opened nine times
  // out of ten and is why this resets every time the run moves up.
  const [openKey, setOpenKey] = useState(FOLLOW_RUN);

  const manualMode = !!roundState?.manual_mode;
  const liveIndex = roundState?.current_question_index;
  const isLiveRound = roundState?.status === 'active';

  const currentPos = questions.findIndex((q) => q.order_index === liveIndex);
  const liveQuestion = currentPos >= 0 ? questions[currentPos] : null;

  const activeLevel = tiers?.activeLevel ?? null;

  // R18 — a database without migration_v12 has no such column on round_state,
  // and serve_question there does not know the parameter: staging is offered
  // only where it can work.
  const stagingAvailable = round === 2 && !!roundState && 'options_staged' in roundState;

  // The lowest guaranteed rung. Everything above it is staged by default;
  // no milestone on the ladder means nothing is.
  const milestoneLevels = (tiers?.tiers || []).filter((t) => t.is_milestone).map((t) => t.level);
  const firstCheckpoint = milestoneLevels.length > 0 ? Math.min(...milestoneLevels) : null;

  const tierOf = (question) =>
    tiers?.tiers.find((t) => t.questions.some((q) => q.id === question.id)) || null;

  const willStage = (tier) => {
    if (!stagingAvailable) return false;
    if (revealMode !== 'auto') return revealMode === 'staged';
    return firstCheckpoint !== null && tier?.level != null && tier.level > firstCheckpoint;
  };

  useEffect(() => {
    setOpenKey(FOLLOW_RUN);
  }, [activeLevel]);

  const serve = async (question, tier = tierOf(question)) => {
    const staged = willStage(tier);

    setBusyId(question.id);
    const { data, error } = await supabase.rpc('serve_question', {
      p_round: round,
      p_question_id: question.id,
      p_clear_responses: clearOnServe,
      // Only sent when staging: a serve that is not staged keeps working on a
      // database whose serve_question has not been replaced yet.
      ...(staged ? { p_staged: true } : {}),
    });
    setBusyId(null);

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to serve question', 'error');
      return;
    }

    // One serve only — see the header.
    setRevealMode('auto');

    const cleared = data.cleared_responses
      ? ` (${data.cleared_responses} previous ${data.cleared_responses === 1 ? 'response' : 'responses'} cleared)`
      : '';
    const stagedNote = staged ? ' — options staged, reveal them when ready' : '';
    onResult(
      (tiers
        ? `Serving for ${question.ladder_level != null ? `rung ${question.ladder_level}` : 'an unfiled question'}${cleared}`
        : `Serving question ${questions.findIndex((q) => q.id === question.id) + 1}${cleared}`) + stagedNote
    );
    onChanged?.();
  };

  /**
   * Serving from anywhere but the rung the run is standing on. Out of turn
   * is legal and sometimes necessary — a question that turned out to be
   * broken, a rung the host wants to re-ask — but it is never what they
   * meant to click, so it asks.
   */
  const serveFromTier = (question, tier) => {
    if (!tier || tier.status === 'active') return serve(question, tier);

    const what =
      tier.status === 'cleared'
        ? `Rung ${tier.level} (${tier.label}) has already been answered. Re-ask it?`
        : tier.level == null
          ? 'This question is not filed on the ladder, so it is not played for any rung. Serve it anyway?'
          : `The run is standing on rung ${activeLevel ?? '—'}. Serving this jumps it to rung ` +
            `${tier.level} (${tier.label}) and skips everything in between. Continue?`;

    if (window.confirm(what)) serve(question, tier);
  };

  const toggleManual = async () => {
    const next = !manualMode;
    const { data, error } = await supabase.rpc('set_manual_mode', {
      p_round: round,
      p_manual: next,
    });

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to change mode', 'error');
      return;
    }

    onResult(next ? 'Manual mode on — you serve each question' : 'Auto-advance on');
    onChanged?.();
  };

  const step = (direction) => {
    const target = questions[currentPos + direction];
    if (target) serve(target);
  };

  if (questions.length === 0) {
    return (
      <div className="qc qc--empty">
        No questions for Round {round} yet — add them in the Questions tab.
      </div>
    );
  }

  // The round is live but current_question_index matches no question in it.
  // Participants see nothing but "Waiting for next question…" and there is
  // no other signal that anything is wrong, so surface it where the host is
  // already looking. Serving any question below fixes it.
  const indexOrphaned = isLiveRound && currentPos < 0;

  const questionRow = (q, i, tier) => {
    const isLive = isLiveRound && q.order_index === liveIndex;
    const answered = tier?.answered?.some((r) => r.question_id === q.id);

    return (
      <li key={q.id} className={`qc-item ${isLive ? 'qc-item--live' : ''}`}>
        <span className="qc-num">{tier ? (answered ? '✓' : i + 1) : i + 1}</span>
        <span className="qc-text" title={q.text}>{q.text}</span>
        <span className="qc-points">{q.base_points} pts</span>
        {willStage(tier) && (
          <span
            className="qc-stage-badge"
            title="Served alone — the options and clock wait for Reveal options"
          >
            staged
          </span>
        )}
        {isLive && <span className="badge badge--active qc-live-badge">LIVE</span>}
        <button
          className={`btn btn-sm ${isLive || (tier && tier.status !== 'active') ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => (tier ? serveFromTier(q, tier) : serve(q))}
          disabled={busyId === q.id}
        >
          {busyId === q.id ? 'Serving…' : isLive ? 'Re-serve' : 'Serve'}
        </button>
      </li>
    );
  };

  // ─── The tiered list (R16) ──────────────────────────────────
  const renderTiers = () => {
    const { tiers: rungs, unfiled, emptyLevels } = tiers;

    // Highest first, like the ladder itself and the host's own panel: the
    // money tree is read top-down, and a console that reads bottom-up next
    // to it makes the host translate between two orders mid-show.
    const ordered = [...rungs].sort((a, b) => b.level - a.level);
    const openTier =
      openKey === FOLLOW_RUN
        ? ordered.find((t) => t.status === 'active') || null
        : ordered.find((t) => t.key === openKey) || null;

    return (
      <div className="qc-tiers">
        {rungs.length === 0 && (
          <div className="qc-warning">
            Round 2 has no prize ladder, so its questions cannot be grouped by
            rung. Set the ladder up in the Prize ladder panel above.
          </div>
        )}

        {emptyLevels.length > 0 && (
          <div className="qc-note">
            No questions filed for rung{emptyLevels.length > 1 ? 's' : ''}{' '}
            {emptyLevels.join(', ')} — the run steps over {emptyLevels.length > 1 ? 'them' : 'it'}.
          </div>
        )}

        {!manualMode && (
          <div className="qc-note qc-note--warn">
            Auto-advance is on, so a settled question moves the round on by
            itself and the tier you pick next is ignored. Switch to manual above.
          </div>
        )}

        {/* The climb at a glance: which rungs are behind the run, which one
            it is on, which are still locked. Bottom-up here on purpose —
            this is a progress bar, and progress reads left to right. */}
        <div className="qc-strip">
          {rungs.map((t) => {
            const summary =
              `Rung ${t.level} — ${t.label} · ` +
              `${t.questions.length} question${t.questions.length === 1 ? '' : 's'} · ${t.status}`;

            return (
              <button
                key={t.key}
                className={`qc-pip qc-pip--${t.status} ${t.key === openTier?.key ? 'qc-pip--open' : ''}`}
                // Both, and the same text: the tooltip is for the host with a
                // mouse, the label for the one on a screen reader, and a pip
                // reading only "3" is no use to either.
                title={summary}
                aria-label={summary}
                onClick={() => setOpenKey(t.key)}
              >
                {t.level}
              </button>
            );
          })}
        </div>

        <ul className="qc-tier-list">
          {ordered.map((t) => {
            const isOpen = t.key === openTier?.key;
            const count = t.questions.length;

            return (
              <li key={t.key} className={`qc-tier qc-tier--${t.status}`}>
                <button
                  className="qc-tier-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpenKey(isOpen ? ALL_CLOSED : t.key)}
                >
                  <span className="qc-tier-caret">{isOpen ? '▾' : '▸'}</span>
                  <span className="qc-tier-level">{t.level}</span>
                  <span className="qc-tier-label">
                    {t.label}
                    {t.is_milestone && <span className="qc-tier-star" title="Guaranteed rung">✦</span>}
                  </span>
                  <span className="qc-tier-count">
                    {count === 0 ? 'no questions' : `${count} q${count === 1 ? '' : 's'}`}
                  </span>
                  <span className="qc-tier-state">
                    {t.status === 'active' && <span className="badge badge--active">NOW</span>}
                    {t.status === 'cleared' && (t.wrong ? '✗' : '✓')}
                    {t.status === 'locked' && '🔒'}
                  </span>
                </button>

                {isOpen && (
                  count === 0 ? (
                    <p className="qc-tier-empty">
                      Nothing written for this rung yet. Add a question in the
                      Questions tab and set its rung to {t.level}.
                    </p>
                  ) : (
                    <ul className="qc-list qc-list--tier">
                      {t.questions.map((q, i) => questionRow(q, i, t))}
                    </ul>
                  )
                )}
              </li>
            );
          })}

          {/* Questions the ladder has no rung for. Last, and never the tier
              the run is standing on — but listed, because a question that has
              silently vanished from the console is worse than one out of place. */}
          {unfiled.length > 0 && (
            <li className="qc-tier qc-tier--unfiled">
              <button
                className="qc-tier-head"
                aria-expanded={openKey === 'unfiled'}
                onClick={() => setOpenKey(openKey === 'unfiled' ? ALL_CLOSED : 'unfiled')}
              >
                <span className="qc-tier-caret">{openKey === 'unfiled' ? '▾' : '▸'}</span>
                <span className="qc-tier-level">—</span>
                <span className="qc-tier-label">Not on the ladder</span>
                <span className="qc-tier-count">{unfiled.length} q{unfiled.length === 1 ? '' : 's'}</span>
                <span className="qc-tier-state">⚠</span>
              </button>

              {openKey === 'unfiled' && (
                <>
                  <p className="qc-tier-empty">
                    These have no rung, or a rung the ladder no longer has. Set
                    one in the Questions tab so they join the climb.
                  </p>
                  <ul className="qc-list qc-list--tier">
                    {unfiled.map((q, i) => questionRow(q, i, { status: 'unfiled', level: null, answered: [] }))}
                  </ul>
                </>
              )}
            </li>
          )}
        </ul>
      </div>
    );
  };

  return (
    <div className="qc">
      {indexOrphaned && (
        <div className="qc-warning">
          Round {round} is live on question index <strong>{String(liveIndex)}</strong>,
          which no question in this round has. Participants are stuck on
          &ldquo;waiting for next question&rdquo;. Serve a question below, or reset
          the round, to recover.
        </div>
      )}

      <div className="qc-toolbar">
        <button
          className={`qc-mode ${manualMode ? 'qc-mode--on' : ''}`}
          onClick={toggleManual}
          title={
            manualMode
              ? 'Participants wait for you between questions'
              : 'Participant clients advance the round themselves when the timer ends'
          }
        >
          <span className="qc-mode-dot" />
          {manualMode ? 'Manual — host serves' : 'Auto-advance'}
        </button>

        <label className="qc-clear-toggle" title="Deletes existing answers for the question you serve, so it can be replayed">
          <input
            type="checkbox"
            checked={clearOnServe}
            onChange={(e) => setClearOnServe(e.target.checked)}
          />
          Clear answers on serve
        </label>

        {/* R18 — only Round 2 has a staged reveal, and only once the database can
            carry one. */}
        {stagingAvailable && (
          <div className="qc-reveal" role="group" aria-label="Options reveal for the next serve">
            <span className="qc-reveal-label">Options</span>
            {[
              ['auto', 'Auto', 'Staged above the first checkpoint, together below it'],
              ['staged', 'Staged', 'Question first; you reveal the options and clock'],
              ['together', 'Together', 'Question, options and clock at once'],
            ].map(([mode, label, hint]) => (
              <button
                key={mode}
                type="button"
                className={`qc-reveal-btn ${revealMode === mode ? 'qc-reveal-btn--on' : ''}`}
                aria-pressed={revealMode === mode}
                title={`${hint} — applies to the next serve only`}
                onClick={() => setRevealMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {round === 2 && tiers && !!roundState && !stagingAvailable && firstCheckpoint !== null && (
        <div className="qc-note">
          Staged option reveal needs the database migration — run
          {' '}<code>supabase/migration_v12.sql</code>, then re-run{' '}
          <code>supabase/rpcs.sql</code>. Until then every question serves
          with its options and clock together.
        </div>
      )}

      {tiers ? renderTiers() : (
        <>
          <div className="qc-steppers">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => step(-1)}
              disabled={currentPos <= 0}
            >
              ← Previous
            </button>
            <span className="qc-position">
              {liveQuestion && isLiveRound
                ? `Live: Q${currentPos + 1} of ${questions.length}`
                : `${questions.length} questions`}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => step(1)}
              disabled={currentPos < 0 || currentPos >= questions.length - 1}
            >
              Next →
            </button>
          </div>

          <ul className="qc-list">
            {questions.map((q, i) => questionRow(q, i, null))}
          </ul>
        </>
      )}

      <style>{`
        .qc {
          width: 100%;
          margin-bottom: var(--space-lg);
          background: rgba(11,20,64, 0.4);
          border: 1px solid rgba(242,183,5,0.1);
          border-radius: var(--radius-md);
          padding: var(--space-md);
          /* The console is a panel inside a column, and the column is a
             different width on every screen. Queried against itself rather
             than the viewport, so a narrow column on a wide monitor stacks
             the same way the same width does on a phone. */
          container: qc / inline-size;
        }

        .qc--empty {
          color: var(--pale-gold);
          font-size: 13px;
          text-align: center;
          padding: var(--space-lg) var(--space-md);
        }

        .qc-warning {
          margin-bottom: var(--space-md);
          padding: 10px 14px;
          border: 1px solid var(--danger-red);
          background: var(--danger-red-soft);
          border-radius: var(--radius-sm);
          font-size: 13px;
          line-height: 1.5;
          color: var(--danger-red);
        }

        .qc-note {
          margin-bottom: var(--space-sm);
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          border: 1px solid rgba(242,183,5,0.18);
          background: rgba(242,183,5,0.06);
          font-size: 12px;
          line-height: 1.5;
          color: var(--pale-gold);
        }

        .qc-note--warn {
          border-color: var(--warning-amber);
          background: var(--warning-amber-soft);
          color: var(--warning-amber);
        }

        .qc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-sm);
          flex-wrap: wrap;
          margin-bottom: var(--space-md);
        }

        .qc-mode {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(242,183,5,0.25);
          background: transparent;
          color: var(--pale-gold);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .qc-mode:hover { border-color: var(--spotlight-gold); color: var(--cloud-white); }

        .qc-mode--on {
          border-color: var(--warning-amber);
          color: var(--warning-amber);
          background: var(--warning-amber-soft);
        }

        .qc-mode-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }

        .qc-clear-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--pale-gold);
          cursor: pointer;
        }

        .qc-reveal {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .qc-reveal-label {
          margin-right: 4px;
          font-size: 12px;
          color: var(--pale-gold);
        }

        .qc-reveal-btn {
          padding: 3px 10px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(242,183,5,0.25);
          background: transparent;
          color: var(--pale-gold);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .qc-reveal-btn:hover { border-color: var(--spotlight-gold); color: var(--cloud-white); }

        .qc-reveal-btn--on {
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.16);
          color: var(--spotlight-gold);
        }

        .qc-stage-badge {
          flex-shrink: 0;
          padding: 1px 8px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(242,183,5,0.4);
          font-size: 11px;
          font-weight: 600;
          color: var(--spotlight-gold);
        }

        .qc-steppers {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-sm);
          padding-bottom: var(--space-md);
          margin-bottom: var(--space-sm);
          border-bottom: 1px solid rgba(242,183,5,0.1);
        }

        .qc-position {
          font-family: 'Poppins', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: var(--spotlight-gold);
          text-align: center;
        }

        .qc-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 320px;
          overflow-y: auto;
        }

        .qc-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          border: 1px solid transparent;
          /* Flex items default to min-width:auto, so a long question pushes
             the row — and every grid column it sits in — wider than the
             panel. This is what put a horizontal scrollbar on the admin. */
          min-width: 0;
        }

        .qc-item:hover { background: rgba(242,183,5,0.06); }

        .qc-item--live {
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.1);
        }

        .qc-num {
          width: 22px;
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 13px;
          color: var(--pale-gold);
        }

        .qc-text {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          color: var(--cloud-white);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .qc-points {
          flex-shrink: 0;
          font-size: 12px;
          color: var(--pale-gold);
        }

        .qc-live-badge { flex-shrink: 0; }

        /* ── Tiers (R16) ── */
        .qc-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding-bottom: var(--space-md);
          margin-bottom: var(--space-sm);
          border-bottom: 1px solid rgba(242,183,5,0.1);
        }

        .qc-pip {
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          border-radius: var(--radius-sm);
          border: 1px solid rgba(242,183,5,0.2);
          background: transparent;
          color: var(--pale-gold);
          font-family: 'Poppins', sans-serif;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .qc-pip:hover { border-color: var(--spotlight-gold); color: var(--cloud-white); }

        .qc-pip--cleared {
          border-color: rgba(242,183,5,0.5);
          color: var(--spotlight-gold);
        }

        .qc-pip--active {
          border-color: var(--spotlight-gold);
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
        }

        .qc-pip--empty { opacity: 0.4; border-style: dashed; }

        .qc-pip--open { box-shadow: 0 0 0 2px rgba(242,183,5,0.3); }

        .qc-tier-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 420px;
          overflow-y: auto;
        }

        .qc-tier {
          border: 1px solid rgba(242,183,5,0.1);
          border-radius: var(--radius-sm);
          background: rgba(11,20,64,0.35);
          min-width: 0;
        }

        .qc-tier--active {
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.08);
        }

        .qc-tier--locked { opacity: 0.6; }

        .qc-tier--unfiled { border-color: var(--warning-amber); }

        .qc-tier-head {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 10px;
          border: none;
          background: transparent;
          color: inherit;
          font-family: 'Inter', sans-serif;
          text-align: left;
          cursor: pointer;
          min-width: 0;
        }

        .qc-tier-head:hover { background: rgba(242,183,5,0.06); }

        .qc-tier-caret {
          width: 12px;
          flex-shrink: 0;
          font-size: 10px;
          color: var(--pale-gold);
        }

        .qc-tier-level {
          width: 22px;
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 13px;
          color: var(--pale-gold);
          text-align: center;
        }

        .qc-tier--active .qc-tier-level,
        .qc-tier--cleared .qc-tier-level { color: var(--spotlight-gold); }

        .qc-tier-label {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--cloud-white);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qc-tier-star { color: var(--cloud-white); font-size: 11px; }

        .qc-tier-count {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--pale-gold);
        }

        .qc-tier-state {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          font-size: 12px;
          color: var(--spotlight-gold);
        }

        .qc-tier--cleared .qc-tier-state { color: var(--pale-gold); }

        .qc-tier-empty {
          padding: 4px 10px 10px 42px;
          font-size: 12px;
          line-height: 1.5;
          color: var(--pale-gold);
        }

        .qc-list--tier {
          max-height: none;
          overflow: visible;
          padding: 0 6px 6px;
        }

        /* Narrow column — the panel's own width, not the window's, so this
           fires for a phone and for the Round 2 card sharing a desktop row. */
        @container qc (max-width: 420px) {
          .qc-points { display: none; }
          .qc-tier-count { display: none; }
          .qc-tier-empty { padding-left: 10px; }
        }

        /* Containment is what the layout above depends on; without it the
           panel never restacks. Browsers that lack it fall back to the
           viewport, which is what this file used to do everywhere. */
        @supports not (container-type: inline-size) {
          @media (max-width: 560px) {
            .qc-points { display: none; }
            .qc-tier-count { display: none; }
          }
        }
      `}</style>
    </div>
  );
}
