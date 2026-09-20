import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import QuestionConsole from './QuestionConsole';
import HotSeatAnswerPanel from './HotSeatAnswerPanel';
import LifelinePanel from './LifelinePanel';
import PrizeLadderPanel from './PrizeLadderPanel';
import { groupByTier, hasRungColumn } from './tiers';

/**
 * Round 2's half of Round Control — the Hot Seat.
 *
 * Everything the host drives during a run: the nomination, the answer
 * lock-in (R7), the four lifelines (R10), the prize ladder (R14) and the
 * tiered question console (R16). Split out of RoundControl because this is
 * the panel that keeps growing, and because the two rounds want different
 * layouts — see the comment in Round1Panel.
 *
 * R16 — this panel owns the tier grouping. It needs two things the rest of
 * Round Control does not: the prize ladder, for the rung labels, and the
 * hot seat's answers, because what opens the next tier is one of this
 * tier's questions having been answered. Both are read here and both come
 * back through realtime, so a rung re-priced or an answer locked in shows up
 * without a reload.
 *
 * Props:
 *   roundState   — the round 2 round_state row
 *   questions    — round 2's questions, ordered by order_index
 *   participants — for the nomination search
 *   hotSeat      — the nominated participant, or null
 *   onResult(message, type) — toast callback owned by the parent
 *   onChanged() — refetch hint after a write
 *   onStart() / onEnd() — round lifecycle, owned by RoundControl
 */

export default function Round2Panel({
  roundState,
  questions,
  participants,
  hotSeat,
  onResult,
  onChanged,
  onStart,
  onEnd,
}) {
  const [search, setSearch] = useState('');
  const [ladder, setLadder] = useState([]);
  const [responses, setResponses] = useState([]);

  const isActive = roundState?.status === 'active';

  // Read here as well as in PrizeLadderPanel, which owns its own copy along
  // with the migration check and the editing. This one is read-only and only
  // needs the rung labels, and threading one fetch through both would make
  // the ladder panel's state this component's problem. It is ten short rows.
  const fetchLadder = useCallback(async () => {
    const { data } = await supabase
      .from('prize_ladder')
      .select('id, level, label, is_milestone')
      .eq('round', 2)
      .order('level');

    // No error branch: a database without migration_v10 has no ladder, and
    // the console says so in the host's own words.
    if (data) setLadder(data);
  }, []);

  /**
   * The hot seat's answers, which is what the tier gate turns on. Scoped to
   * the nominated participant rather than the whole round: responses from a
   * previous contestant's run are not this run's progress, and a ladder that
   * opens on somebody else's climb is worse than one that opens on nothing.
   */
  const fetchResponses = useCallback(async () => {
    if (!hotSeat) {
      setResponses([]);
      return;
    }

    const { data } = await supabase
      .from('responses')
      .select('question_id, is_correct')
      .eq('participant_id', hotSeat.id)
      .eq('round', 2);

    if (data) setResponses(data);
  }, [hotSeat]);

  useEffect(() => {
    fetchLadder();
    fetchResponses();

    const channel = supabase
      .channel('round2-panel-tiers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prize_ladder' },
        () => fetchLadder()
      )
      // Every event, not just INSERT: clearing an answer on serve has to put
      // the run back down a rung, or a re-asked question stays locked behind
      // the tier it already cleared.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'responses' },
        () => fetchResponses()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLadder, fetchResponses]);

  // A database without migration_v11 has no rung on any question, and
  // grouping by one would file the whole bank under "not on the ladder" —
  // technically true and completely useless. It gets the flat console it had
  // before R16, plus the one line that fixes it.
  const tiered = hasRungColumn(questions);

  const tiers = useMemo(
    () => groupByTier(questions, ladder, responses),
    [questions, ladder, responses]
  );

  const nominate = async (participantId) => {
    const { data, error } = await supabase.rpc('nominate_hotseat', {
      p_participant_id: participantId,
    });

    if (error || !data?.success) {
      onResult(error?.message || data?.error || 'Failed to nominate', 'error');
      return;
    }

    onResult(participantId ? `${data.roll_no} nominated for the hot seat` : 'Hot seat cleared');
    setSearch('');
    onChanged();
  };

  const filteredParticipants = participants.filter((p) => {
    const q = search.toLowerCase();
    return p.roll_no.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="r2p">
      <p className="r2p-desc">
        Nominate one participant for the hot seat. Only they see active
        questions; everyone else gets a disabled placeholder. The contestant
        says their answer aloud and you lock it in here — their screen is
        read-only.
      </p>

      <div className="r2p-hs-select">
        <label className="form-label">Hot seat</label>

        {hotSeat ? (
          <div className="r2p-selected-player">
            <span className="r2p-player-roll">{hotSeat.roll_no}</span>
            <span className="r2p-player-name">{hotSeat.name || '—'}</span>
            {!isActive && (
              <button
                className="btn-icon r2p-clear-hs"
                title="Clear nomination"
                onClick={() => nominate(null)}
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <div className="r2p-participant-search">
            <input
              type="text"
              className="form-input"
              placeholder="Search participant to nominate…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {search && (
              <div className="r2p-search-results">
                {filteredParticipants.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="r2p-search-item"
                    onClick={() => nominate(p.id)}
                  >
                    <span className="r2p-item-roll">{p.roll_no}</span>
                    <span
                      className="r2p-item-name"
                      style={p.network_status === 'failed'
                        ? { color: 'var(--danger-red)' }
                        : undefined}
                    >
                      {p.name || '—'}
                    </span>
                  </div>
                ))}
                {filteredParticipants.length === 0 && (
                  <div className="r2p-search-empty">No matches</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <HotSeatAnswerPanel
        roundState={roundState}
        questions={questions}
        hotSeat={hotSeat}
        onResult={onResult}
        onChanged={onChanged}
      />

      <LifelinePanel
        roundState={roundState}
        questions={questions}
        onResult={onResult}
      />

      {/* R14 — how many rungs the run has and what each one pays.
          Always available: the ladder is drawn up before the round
          starts, and a rung re-priced mid-run should not need the
          round ended to change it. */}
      <PrizeLadderPanel round={2} onResult={onResult} />

      {/* R16 — grouped by rung, and only the rung the run is standing on is
          open. The ladder is passed through the grouping rather than to the
          console, so a console with no ladder behind it degrades to saying
          so instead of guessing at tiers. */}
      {!tiered && (
        <div className="r2p-blocked">
          Question tiers need the database migration — run
          {' '}<code>supabase/migration_v11.sql</code>. Until then Round 2
          serves its questions in one flat list, in order.
        </div>
      )}

      <QuestionConsole
        round={2}
        roundState={roundState}
        questions={questions}
        tiers={tiered ? tiers : null}
        onResult={onResult}
        onChanged={onChanged}
      />

      <button
        className={`btn r2p-go ${isActive ? 'btn-danger' : 'btn-primary'}`}
        onClick={() => {
          if (isActive) {
            if (window.confirm('End Round 2 early?')) onEnd();
          } else if (window.confirm(`Start Round 2 for ${hotSeat?.roll_no}?`)) {
            onStart();
          }
        }}
        disabled={!isActive && !hotSeat}
      >
        {isActive ? 'End Round 2' : 'Start Round 2'}
      </button>

      <style>{`
        .r2p {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          min-width: 0;
        }

        .r2p-desc {
          color: var(--pale-gold);
          font-size: 14px;
          margin-bottom: var(--space-lg);
          line-height: 1.5;
        }

        .r2p-hs-select {
          width: 100%;
          margin-bottom: var(--space-lg);
          background: rgba(11,20,64, 0.4);
          padding: var(--space-md);
          border-radius: var(--radius-md);
          border: 1px solid rgba(242,183,5,0.1);
        }

        .r2p-participant-search {
          position: relative;
          margin-top: var(--space-xs);
        }

        .r2p-participant-search input { width: 100%; }

        .r2p-search-results {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--deep-midnight);
          border: 1px solid var(--antique-gold);
          border-radius: var(--radius-md);
          margin-top: 4px;
          max-height: 200px;
          overflow-y: auto;
          z-index: 10;
          box-shadow: var(--shadow-card);
        }

        .r2p-search-item {
          padding: 10px 14px;
          display: flex;
          gap: 12px;
          cursor: pointer;
          border-bottom: 1px solid rgba(242,183,5,0.1);
          min-width: 0;
        }

        .r2p-search-item:hover { background: rgba(242,183,5,0.08); }

        .r2p-item-roll {
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--cloud-white);
        }

        .r2p-item-name {
          min-width: 0;
          color: var(--pale-gold);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .r2p-search-empty {
          padding: 10px 14px;
          color: var(--pale-gold);
          font-size: 13px;
          text-align: center;
        }

        .r2p-selected-player {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: var(--space-xs);
          padding: 12px;
          background: rgba(242,183,5,0.1);
          border: 1px solid var(--antique-gold);
          border-radius: var(--radius-md);
          min-width: 0;
        }

        .r2p-player-roll {
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 18px;
          color: var(--spotlight-gold);
        }

        .r2p-player-name {
          min-width: 0;
          font-size: 16px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .r2p-clear-hs {
          margin-left: auto;
          flex-shrink: 0;
        }

        .r2p-blocked {
          width: 100%;
          margin-bottom: var(--space-sm);
          padding: 10px 14px;
          border: 1px solid var(--warning-amber);
          background: var(--warning-amber-soft);
          border-radius: var(--radius-sm);
          font-size: 13px;
          line-height: 1.5;
          color: var(--warning-amber);
        }

        .r2p-blocked code {
          font-family: monospace;
          font-size: 12px;
        }

        .r2p-go { flex-shrink: 0; }

        @media (max-width: 560px) {
          .r2p-go { width: 100%; }
          .r2p-player-roll { font-size: 16px; }
          .r2p-player-name { font-size: 14px; }
        }
      `}</style>
    </div>
  );
}
