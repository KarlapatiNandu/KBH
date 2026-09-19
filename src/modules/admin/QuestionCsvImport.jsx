import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { toCsv } from './csv';
import { TEMPLATE_ROWS, parseQuestionCsv, withOrderIndex } from './questionCsv';

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
 */

export default function QuestionCsvImport({ onImported, onClose, showToast }) {
  const [parsed, setParsed] = useState(null);   // { rows, errors, fileName }
  const [fatal, setFatal] = useState(null);     // whole-file problem
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

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
      setParsed({ fileName: file.name, rows: result.rows, errors: result.errors });
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
    const { data: existing, error: readError } = await supabase
      .from('questions')
      .select('round, order_index');

    if (readError) {
      showToast(`Import failed: ${readError.message}`, 'error');
      setImporting(false);
      return;
    }

    const payload = withOrderIndex(parsed.rows, existing);

    const { error } = await supabase.from('questions').insert(payload);

    if (error) {
      showToast(`Import failed: ${error.message}`, 'error');
    } else {
      showToast(`Imported ${payload.length} question${payload.length > 1 ? 's' : ''}`);
      reset();
      onImported?.();
      onClose?.();
    }
    setImporting(false);
  };

  const roundCount = (n) => parsed.rows.filter((r) => r.round === n).length;

  return (
    <div className="qci card card--solid">
      <div className="qci-header">
        <h3>Import Questions via CSV</h3>
        <button className="btn-icon" onClick={onClose} title="Close">✕</button>
      </div>

      <p className="qci-help">
        Required columns: <code>round</code>, <code>text</code>, <code>option_a</code>–<code>option_d</code>,{' '}
        <code>correct</code> (A–D or 1–4). Optional: <code>base_points</code> (default 100),{' '}
        <code>duration_s</code> (blank uses the round default), <code>prize</code>.
        Imported questions are added after the existing ones in their round — nothing is overwritten.
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
                    </tr>
                  ))}
                  {parsed.rows.length > 20 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--pale-gold)' }}>
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

        .qci-table-wrap {
          max-height: 340px;
          overflow-y: auto;
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
