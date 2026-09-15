import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Module 2 — Participants
 *
 * CSV import plus the live roster. Two things beyond v1:
 *   R2 — a Network column fed by the post-login check. Anyone whose check
 *        failed has their name rendered in red so the host can spot them
 *        before the round starts. Kept live via a realtime subscription.
 *   R4 — Nominate sends a participant to the Round 2 hot seat without
 *        starting the round.
 */

const NETWORK_LABELS = {
  passed: 'Passed',
  failed: 'Failed',
  pending: 'Not checked',
};

export default function ParticipantImport() {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [csvPreview, setCsvPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [revealedPins, setRevealedPins] = useState(new Set());

  useEffect(() => {
    fetchParticipants();

    // Network-check verdicts land while the host is watching this screen.
    const channel = supabase
      .channel('admin-participants')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants' },
        (payload) => {
          const updated = payload.new;
          if (!updated || !updated.id) return; // DELETE carries no new row
          setParticipants((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchParticipants = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('participants')
      .select('*')
      .order('roll_no', { ascending: true });

    if (error) {
      showToast('Failed to load participants', 'error');
    } else {
      setParticipants(data || []);
    }
    setLoading(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        showToast('CSV is empty', 'error');
        return;
      }

      // Parse header
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const rollIdx = header.indexOf('roll_no');
      const nameIdx = header.indexOf('name');

      if (rollIdx === -1) {
        showToast('CSV must have a "roll_no" column', 'error');
        return;
      }

      // Parse rows
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const rollNo = cols[rollIdx];
        const name = nameIdx !== -1 ? cols[nameIdx] : null;

        if (rollNo) {
          rows.push({ roll_no: rollNo, name: name || null });
        }
      }

      setCsvPreview(rows);
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!csvPreview || csvPreview.length === 0) return;

    setImporting(true);
    const { error } = await supabase
      .from('participants')
      .upsert(csvPreview, { onConflict: 'roll_no' });

    if (error) {
      showToast(`Import failed: ${error.message}`, 'error');
    } else {
      showToast(`Imported ${csvPreview.length} participants`);
      setCsvPreview(null);
      fetchParticipants();
    }
    setImporting(false);
  };

  const deleteParticipant = async (id) => {
    if (!window.confirm('Remove this participant?')) return;

    const { error } = await supabase.from('participants').delete().eq('id', id);
    if (error) {
      showToast('Failed to delete', 'error');
    } else {
      showToast('Participant removed');
      fetchParticipants();
    }
  };

  const nominateHotSeat = async (p) => {
    if (!window.confirm(`Nominate ${p.roll_no} for the Round 2 hot seat?`)) return;

    const { data, error } = await supabase.rpc('nominate_hotseat', {
      p_participant_id: p.id,
    });

    if (error || !data?.success) {
      showToast(error?.message || data?.error || 'Failed to nominate', 'error');
    } else {
      showToast(`${p.roll_no} nominated for the hot seat`);
    }
  };

  const resetPin = async (p) => {
    if (!window.confirm(
      `Reset the PIN for ${p.roll_no}?\n\nThey will set a new one on their next login.`
    )) return;

    const { error } = await supabase
      .from('participants')
      .update({ pin: null })
      .eq('id', p.id);

    if (error) {
      showToast('Failed to reset PIN', 'error');
    } else {
      showToast(`PIN reset for ${p.roll_no}`);
      fetchParticipants();
    }
  };

  const togglePinReveal = (id) => {
    setRevealedPins((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredParticipants = participants.filter((p) => {
    const q = search.toLowerCase();
    return p.roll_no.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="pi">
      {/* CSV Import Section */}
      <div className="pi-import-section card card--solid">
        <h3>Import Participants via CSV</h3>
        <p className="pi-import-help">
          Upload a CSV with columns: <code>roll_no</code> (required), <code>name</code> (optional).
          Existing roll numbers will be updated with new name values.
        </p>

        <div className="pi-import-row">
          <label className="btn btn-secondary btn-sm pi-file-label">
            📄 Choose CSV File
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* CSV Preview */}
        {csvPreview && (
          <div className="pi-preview">
            <div className="pi-preview-header">
              <span className="pi-preview-count">{csvPreview.length} participants to import</span>
              <div className="pi-preview-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setCsvPreview(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={confirmImport} disabled={importing}>
                  {importing ? 'Importing…' : 'Confirm Import'}
                </button>
              </div>
            </div>
            <div className="pi-preview-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Roll No</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{row.roll_no}</td>
                      <td>{row.name || '—'}</td>
                    </tr>
                  ))}
                  {csvPreview.length > 20 && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', color: 'var(--pale-gold)' }}>
                        …and {csvPreview.length - 20} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Current Participants */}
      <div className="pi-list-section">
        <div className="pi-list-toolbar">
          <h3>Current Participants ({participants.length})</h3>
          <input
            type="text"
            className="form-input pi-search"
            placeholder="Search by roll no or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="pi-loading">Loading participants…</div>
        ) : filteredParticipants.length === 0 ? (
          <div className="pi-empty">
            {search ? 'No matches found.' : "No participants yet — it's a ghost town. Import a CSV above."}
          </div>
        ) : (
          <div className="pi-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Network</th>
                  <th>PIN</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredParticipants.map((p, i) => {
                  const netFailed = p.network_status === 'failed';

                  return (
                    <tr key={p.id}>
                      <td>{i + 1}</td>
                      <td style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>{p.roll_no}</td>
                      {/* R2 — a failed network check paints the name red */}
                      <td className={netFailed ? 'pi-name--failed' : undefined}>
                        {p.name || '—'}
                      </td>
                      <td>
                        <span
                          className={`badge badge--${
                            p.network_status === 'passed'
                              ? 'active'
                              : netFailed
                                ? 'wrong'
                                : 'pending'
                          }`}
                          title={p.network_detail || 'No check recorded yet'}
                        >
                          {NETWORK_LABELS[p.network_status] || 'Not checked'}
                          {p.network_latency_ms != null && ` · ${p.network_latency_ms}ms`}
                        </span>
                      </td>
                      <td>
                        {p.pin ? (
                          <button
                            className="pi-pin-reveal"
                            onClick={() => togglePinReveal(p.id)}
                            title={revealedPins.has(p.id) ? 'Hide PIN' : 'Show PIN'}
                          >
                            {revealedPins.has(p.id) ? p.pin : '••••'}
                          </button>
                        ) : (
                          <span className="badge badge--pending">Unclaimed</span>
                        )}
                      </td>
                      <td className="pi-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => nominateHotSeat(p)}
                          title="Nominate for the Round 2 hot seat"
                        >
                          Nominate
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => resetPin(p)}
                          title="Reset PIN"
                          disabled={!p.pin}
                        >
                          🔑
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => deleteParticipant(p.id)}
                          title="Remove"
                          style={{ color: 'var(--danger-red)' }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast--${toast.type}`}>{toast.message}</div>
      )}

      <style>{`
        /* R2 — failed network check */
        .pi-name--failed {
          color: var(--danger-red);
          font-weight: 600;
        }

        .pi-pin-reveal {
          border: 1px solid rgba(242,183,5,0.2);
          background: rgba(242,183,5,0.08);
          color: var(--spotlight-gold);
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 13px;
          letter-spacing: 0.5px;
          padding: 4px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          min-width: 52px;
        }

        .pi-pin-reveal:hover {
          background: rgba(242,183,5,0.16);
        }

        .pi-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }

        .pi-import-section {
          padding: var(--space-lg);
          margin-bottom: var(--space-xl);
        }

        .pi-import-section h3 {
          font-size: 18px;
          margin-bottom: var(--space-xs);
        }

        .pi-import-help {
          font-size: 13px;
          color: var(--pale-gold);
          margin-bottom: var(--space-md);
          line-height: 1.5;
        }

        .pi-import-help code {
          background: rgba(242,183,5,0.12);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          color: var(--spotlight-gold);
        }

        .pi-import-row {
          display: flex;
          gap: var(--space-md);
          align-items: center;
        }

        .pi-file-label {
          cursor: pointer;
        }

        .pi-preview {
          margin-top: var(--space-md);
          border-top: 1px solid rgba(242,183,5,0.15);
          padding-top: var(--space-md);
        }

        .pi-preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-md);
          flex-wrap: wrap;
          gap: var(--space-sm);
        }

        .pi-preview-count {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 14px;
          color: var(--spotlight-gold);
        }

        .pi-preview-actions {
          display: flex;
          gap: var(--space-sm);
        }

        .pi-preview-table-wrap {
          max-height: 300px;
          overflow-y: auto;
          border-radius: var(--radius-sm);
        }

        .pi-list-section {
          margin-top: var(--space-md);
        }

        .pi-list-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-md);
          flex-wrap: wrap;
          gap: var(--space-md);
        }

        .pi-list-toolbar h3 {
          font-size: 18px;
        }

        .pi-search {
          max-width: 280px;
        }

        .pi-table-wrap {
          max-height: 500px;
          overflow-y: auto;
          border-radius: var(--radius-md);
          border: 1px solid rgba(242,183,5,0.1);
        }

        .pi-loading, .pi-empty {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--pale-gold);
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}
