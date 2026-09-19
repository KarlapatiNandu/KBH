import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { toCsv } from './csv';
import { TEMPLATE_ROWS, parseQuestionCsv, withOrderIndex, summariseRungs } from './questionCsv';

/**
 * Bulk question import.
 *
 * Questions are written by hand in a spreadsheet long before the event, so
 * the admin panel needs a way in that isn't "type forty questions into the
 * form". Everything is validated and previewed before a single row is
 * written — a half-imported question set discovered mid-quiz is not a thing
 * anyone wants to debug.
 *
 * Rows are appended after the existing questions for their round; nothing
 * already in the table is touched.
 *
 * R16 — a round 2 question is played for a prize rung (`ladder_level`), and
 * several questions may share one. That makes a bulk import the moment a whole
 * run gets filed onto the ladder at once, so the preview does not just list
 * rows: it shows what each rung ends up holding, which rungs would still have
 * nothing to ask, and which rungs the file names that the ladder does not
 * have. A twenty-row table hides all three.
 */

export default function QuestionCsvImport({ onImported, onClose, showToast }) {
  const [parsed, setParsed] = useState(null);   // { rows, errors, warnings, fileName }
  const [fatal, setFatal] = useState(null);     // whole-file problem
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  // The ladder, and the rungs round 2's existing questions already sit on —
  // both only so the preview can say where this file lands. Read when the
  // panel opens; the host is not editing the ladder in another tab mid-import.
  const [ladder, setLadder] = useState([]);
  const [onLadder, setOnLadder] = useState([]);

  useEffect(() => {
    let live = true;

    (async () => {
      const { data: rungs } = await supabase
        .from('prize_ladder')
        .select('level, label')
        .eq('round', 2)
        .order('level');
      if (live && rungs) setLadder(rungs);

      // Naming `ladder_level` fails outright without migration_v11, which is
      // exactly the signal wanted: no column, no rung summary to show.
      const { data: filed } = await supabase
        .from('questions')
        .select('ladder_level')
        .eq('round', 2);
      if (live && filed) setOnLadder(filed.map((q) => q.ladder_level));
    })();

    return () => { live = false; };
  }, []);

  const reset = () => {
    setParsed(null);
    setFatal(null);
    if (fileInputRef.current) fileInputRef.current.value = ''; // re-picking the same file must re-fire onChange
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFatal(null);
    setParsed(null);

    const reader = new FileReader();
    reader.onerror = () => setFatal("Couldn't read that file.");
    reader.onload = (event) => {
      const result = parseQuestionCsv(event.target.result);
      if (result.fatal) return setFatal(result.fatal);
      setParsed({
        fileName: file.name,
        rows: result.rows,
        errors: result.errors,
        warnings: result.warnings,
      });
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([toCsv(TEMPLATE_ROWS)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kbh-questions-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const confirmImport = async () => {
    if (!parsed || parsed.errors.length || parsed.rows.length === 0) return;
    setImporting(true);

    // Read the tail of each round now rather than trusting the list the host
    // loaded minutes ago — a duplicate order_index would desynchronise the
    // host console, which addresses questions by index. (ISSUES 1.4)
    // This read doubles as the probe for `ladder_level`: naming a column that
    // does not exist fails the whole statement, and that failure is the only
    // reliable way to tell an absent column from a table that is merely empty.
    // Getting it wrong would send `ladder_level` to a database without
    // migration_v11 and fail the entire import. (R16)
    let hasRungs = true;
    let { data: existing, error: readError } = await supabase
      .from('questions')
      .select('round, order_index, ladder_level');

    if (readError && /ladder_level/i.test(readError.message)) {
      hasRungs = false;
      ({ data: existing, error: readError } = await supabase
        .from('questions')
        .select('round, order_index'));
    }

    if (readError) {
      showToast(`Import failed: ${readError.message}`, 'error');
      setImporting(false);
      return;
    }

    const withRungs = withOrderIndex(parsed.rows, existing);
    const payload = hasRungs
      ? withRungs
      : withRungs.map((r) => {
          const stripped = { ...r };
          delete stripped.ladder_level;
          return stripped;
        });

    const { error } = await supabase.from('questions').insert(payload);

    if (error) {
      showToast(`Import failed: ${error.message}`, 'error');
    } else {
      showToast(
        `Imported ${payload.length} question${payload.length > 1 ? 's' : ''}` +
        (hasRungs ? '' : ' — prize rungs were skipped, the database needs migration_v11')
      );
      reset();
      onImported?.();
      onClose?.();
    }
    setImporting(false);
  };

  const roundCount = (n) => parsed.rows.filter((r) => r.round === n).length;

  // Only worth drawing when there is a ladder to draw and round 2 rows to place
  // on it. A round 1 only import has nothing to say here.
  const rungSummary =
    parsed && ladder.length > 0 && roundCount(2) > 0
      ? summariseRungs(parsed.rows, ladder, onLadder)
      : null;

  return (
    <div className="qci card card--solid">
      <div className="qci-header">
        <h3>Import Questions via CSV</h3>
        <button className="btn-icon" onClick={onClose} title="Close">✕</button>
      </div>

      <p className="qci-help">
        Required columns: <code>round</code>, <code>text</code>, <code>option_a</code>–<code>option_d</code>,{' '}
        <code>correct</code> (A–D or 1–4). Optional: <code>base_points</code> (default 100),{' '}
        <code>duration_s</code> (blank uses the round default), <code>prize</code>,{' '}
        <code>ladder_level</code> — Round 2's prize rung, also spelled{' '}
        <code>rung</code>, <code>tier</code> or <code>level</code>. Several questions
        may share a rung: they become the pool the host picks from for it, and the
        run moves up once one of them is answered. Round 1 has no ladder and ignores
        the column. Imported questions are added after the existing ones in their
        round — nothing is overwritten.
      </p>

      <div className="qci-actions-row">
        <label className="btn btn-secondary btn-sm qci-file-label">
          📄 Choose CSV File
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
        </label>
        <button className="btn btn-secondary btn-sm" onClick={downloadTemplate}>
          ⬇ Download Template
        </button>
        {parsed && <span className="qci-file-name">{parsed.fileName}</span>}
      </div>

      {fatal && <div className="qci-fatal">{fatal}</div>}

      {parsed && (
        <div className="qci-preview">
          <div className="qci-preview-header">
            <span className="qci-count">
              {parsed.rows.length} question{parsed.rows.length === 1 ? '' : 's'} ready
              {parsed.rows.length > 0 && (
                <span className="qci-count-split">
                  {' '}· R1: {roundCount(1)} · R2: {roundCount(2)}
                </span>
              )}
              {parsed.errors.length > 0 && (
                <span className="qci-count-bad"> · {parsed.errors.length} row(s) with problems</span>
              )}
            </span>
            <div className="qci-preview-actions">
              <button className="btn btn-secondary btn-sm" onClick={reset}>Clear</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={confirmImport}
                disabled={importing || parsed.errors.length > 0 || parsed.rows.length === 0}
                title={parsed.errors.length > 0 ? 'Fix the rows listed below, then re-upload' : undefined}
              >
                {importing ? 'Importing…' : `Import ${parsed.rows.length}`}
              </button>
            </div>
          </div>

          {parsed.errors.length > 0 && (
            <div className="qci-errors">
              <div className="qci-errors-title">
                Nothing is imported until these are fixed:
              </div>
              <ul>
                {parsed.errors.slice(0, 15).map((e) => (
                  <li key={e.lineNo}>
                    <strong>Line {e.lineNo}</strong> — {e.errors.join('; ')}
                  </li>
                ))}
                {parsed.errors.length > 15 && <li>…and {parsed.errors.length - 15} more</li>}
              </ul>
            </div>
          )}

          {/* R16 — worth saying, not worth refusing the file over. The Import
              button stays enabled: these are questions that import fine but
              land somewhere the host may not have meant. */}
          {parsed.warnings.length > 0 && (
            <div className="qci-warnings">
              <div className="qci-warnings-title">
                These import, but check them first:
              </div>
              <ul>
                {parsed.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}

          {rungSummary && (
            <div className="qci-rungs">
              <div className="qci-rungs-title">
                Where this lands on the prize ladder
              </div>

              <div className="qci-rung-grid">
                {rungSummary.perRung.map((r) => (
                  <div
                    key={r.level}
                    className={`qci-rung ${r.incoming > 0 ? 'qci-rung--filling' : ''} ${
                      r.incoming + r.existing === 0 ? 'qci-rung--empty' : ''
                    }`}
                    title={
                      `Rung ${r.level} — ${r.label}: ` +
                      `${r.existing} already filed, ${r.incoming} in this file`
                    }
                  >
                    <span className="qci-rung-level">{r.level}</span>
                    <span className="qci-rung-label">{r.label}</span>
                    <span className="qci-rung-count">
                      {r.incoming > 0 && <strong>+{r.incoming}</strong>}
                      {r.existing > 0 && <span className="qci-rung-have"> {r.existing} have</span>}
                      {r.incoming + r.existing === 0 && <span className="qci-rung-none">nothing</span>}
                    </span>
                  </div>
                ))}
              </div>

              {rungSummary.emptyAfter.length > 0 && (
                <p className="qci-rung-note">
                  Rung{rungSummary.emptyAfter.length > 1 ? 's' : ''}{' '}
                  {rungSummary.emptyAfter.join(', ')} will still have no question to
                  ask, so the run steps over{' '}
                  {rungSummary.emptyAfter.length > 1 ? 'them' : 'it'} and{' '}
                  {rungSummary.emptyAfter.length > 1 ? 'they pay' : 'it pays'} nothing.
                </p>
              )}

              {rungSummary.aboveLadder.length > 0 && (
                <p className="qci-rung-note qci-rung-note--warn">
                  The file uses rung{rungSummary.aboveLadder.length > 1 ? 's' : ''}{' '}
                  {rungSummary.aboveLadder.join(', ')}, but the ladder is only{' '}
                  {rungSummary.top} rung{rungSummary.top === 1 ? '' : 's'} tall — those
                  questions import off the ladder and are never asked. Lengthen the
                  ladder in Round Control, or renumber them.
                </p>
              )}

              {rungSummary.unfiled > 0 && (
                <p className="qci-rung-note qci-rung-note--warn">
                  {rungSummary.unfiled} round 2 question
                  {rungSummary.unfiled === 1 ? '' : 's'} in this file
                  {rungSummary.unfiled === 1 ? ' has' : ' have'} no rung at all.
                </p>
              )}
            </div>
          )}

          {parsed.rows.length > 0 && (
            <div className="qci-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Rd</th>
                    <th>Question</th>
                    <th>Correct</th>
                    <th>Pts</th>
                    <th>Time</th>
                    <th>Prize</th>
                    <th>Rung</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{r.round}</td>
                      <td className="qci-text-cell" title={r.text}>{r.text}</td>
                      <td>
                        <span className="qci-correct">
                          {String.fromCharCode(65 + r.correct_option)}
                        </span>{' '}
                        {r.options[r.correct_option]}
                      </td>
                      <td>{r.base_points}</td>
                      <td>{r.duration_ms != null ? `${r.duration_ms / 1000}s` : 'default'}</td>
                      <td>{r.prize || '—'}</td>
                      <td>{r.ladder_level ?? '—'}</td>
                    </tr>
                  ))}
                  {parsed.rows.length > 20 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--pale-gold)' }}>
                        …and {parsed.rows.length - 20} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`
        .qci {
          padding: var(--space-lg);
          margin-bottom: var(--space-lg);
        }

        .qci-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-xs);
        }

        .qci-header h3 {
          font-size: 18px;
        }

        .qci-help {
          font-size: 13px;
          color: var(--pale-gold);
          line-height: 1.6;
          margin-bottom: var(--space-md);
        }

        .qci-help code {
          background: rgba(242,183,5,0.12);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          color: var(--spotlight-gold);
        }

        .qci-actions-row {
          display: flex;
          gap: var(--space-md);
          align-items: center;
          flex-wrap: wrap;
        }

        .qci-file-label {
          cursor: pointer;
        }

        .qci-file-name {
          font-size: 12px;
          color: var(--pale-gold);
        }

        .qci-fatal {
          margin-top: var(--space-md);
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          background: rgba(214, 40, 40, 0.12);
          border: 1px solid rgba(214, 40, 40, 0.35);
          color: var(--danger-red);
          font-size: 13px;
        }

        .qci-preview {
          margin-top: var(--space-md);
          border-top: 1px solid rgba(242,183,5,0.15);
          padding-top: var(--space-md);
        }

        .qci-preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-sm);
          flex-wrap: wrap;
          margin-bottom: var(--space-md);
        }

        .qci-count {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 14px;
          color: var(--spotlight-gold);
        }

        .qci-count-split {
          font-weight: 400;
          color: var(--pale-gold);
        }

        .qci-count-bad {
          color: var(--danger-red);
        }

        .qci-preview-actions {
          display: flex;
          gap: var(--space-sm);
        }

        .qci-errors {
          margin-bottom: var(--space-md);
          padding: 12px 14px;
          border-radius: var(--radius-sm);
          background: rgba(214, 40, 40, 0.1);
          border: 1px solid rgba(214, 40, 40, 0.3);
        }

        .qci-errors-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--danger-red);
          margin-bottom: 6px;
        }

        .qci-errors ul {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          color: var(--pale-gold);
          line-height: 1.7;
        }

        /* ── Warnings: the same shape as the errors block, in amber, because
              they read the same way and mean something different. ── */
        .qci-warnings {
          margin-bottom: var(--space-md);
          padding: 12px 14px;
          border-radius: var(--radius-sm);
          background: var(--warning-amber-soft);
          border: 1px solid var(--warning-amber);
        }

        .qci-warnings-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--warning-amber);
          margin-bottom: 6px;
        }

        .qci-warnings ul {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          color: var(--pale-gold);
          line-height: 1.7;
        }

        /* ── Where the import lands on the ladder (R16) ── */
        .qci-rungs {
          margin-bottom: var(--space-md);
          padding: 12px 14px;
          border-radius: var(--radius-sm);
          background: rgba(11,20,64,0.45);
          border: 1px solid rgba(242,183,5,0.15);
        }

        .qci-rungs-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--spotlight-gold);
          margin-bottom: 8px;
        }

        /* auto-fill rather than a fixed count: this panel is as wide as the
           Questions tab gives it, which is not a number this file knows. */
        .qci-rung-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 4px;
        }

        .qci-rung {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 8px;
          border-radius: var(--radius-sm);
          border: 1px solid rgba(242,183,5,0.12);
          font-size: 12px;
          min-width: 0;
        }

        .qci-rung--filling {
          border-color: var(--spotlight-gold);
          background: rgba(242,183,5,0.08);
        }

        .qci-rung--empty { border-style: dashed; opacity: 0.75; }

        .qci-rung-level {
          width: 20px;
          flex-shrink: 0;
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--pale-gold);
          text-align: center;
        }

        .qci-rung-label {
          flex: 1;
          min-width: 0;
          color: var(--cloud-white);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qci-rung-count {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--spotlight-gold);
          white-space: nowrap;
        }

        .qci-rung-have { color: var(--pale-gold); }
        .qci-rung-none { color: var(--pale-gold); opacity: 0.7; }

        .qci-rung-note {
          margin: 8px 0 0;
          font-size: 12px;
          line-height: 1.6;
          color: var(--pale-gold);
        }

        .qci-rung-note--warn { color: var(--warning-amber); }

        .qci-table-wrap {
          max-height: 340px;
          overflow-y: auto;
          /* Eight columns since the rung was added (R16). Spelled out rather
             than left to the spec's one-axis-forces-the-other rule: the point
             is that the table scrolls inside this box, never the page. */
          overflow-x: auto;
          border-radius: var(--radius-sm);
        }

        .qci-text-cell {
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .qci-correct {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--success-green);
          color: var(--deep-midnight);
          font-size: 11px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
