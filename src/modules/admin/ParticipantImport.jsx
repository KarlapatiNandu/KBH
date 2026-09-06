import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function ParticipantImport() {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [csvPreview, setCsvPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchParticipants();
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
                      <td colSpan={3} style={{ textAlign: 'center', color: 'var(--serene-seafoam)' }}>
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
            {search ? 'No matches found.' : 'No participants yet. Import via CSV above.'}
          </div>
        ) : (
          <div className="pi-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>PIN Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredParticipants.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>{p.roll_no}</td>
                    <td>{p.name || '—'}</td>
                    <td>
                      <span className={`badge ${p.pin_hash ? 'badge--active' : 'badge--pending'}`}>
                        {p.pin_hash ? 'Claimed' : 'Unclaimed'}
                      </span>
                    </td>
                    <td>
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
                ))}
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
          color: var(--serene-seafoam);
          margin-bottom: var(--space-md);
          line-height: 1.5;
        }

        .pi-import-help code {
          background: rgba(36,184,175,0.12);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          color: var(--ocean-aqua);
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
          border-top: 1px solid rgba(36,184,175,0.15);
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
          color: var(--ocean-aqua);
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
          border: 1px solid rgba(36,184,175,0.1);
        }

        .pi-loading, .pi-empty {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--serene-seafoam);
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}
