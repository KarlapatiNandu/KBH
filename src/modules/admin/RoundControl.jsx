import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function RoundControl() {
  const [round1, setRound1] = useState(null);
  const [round2, setRound2] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [participants, setParticipants] = useState([]);
  const [selectedParticipant, setSelectedParticipant] = useState(null);

  useEffect(() => {
    fetchState();
    fetchParticipants();

    // Subscribe to round state changes
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_state' },
        (payload) => {
          if (payload.new.round === 1) setRound1(payload.new);
          if (payload.new.round === 2) setRound2(payload.new);
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

  const fetchState = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('round_state').select('*');
    if (!error && data) {
      const r1 = data.find((r) => r.round === 1);
      const r2 = data.find((r) => r.round === 2);
      setRound1(r1);
      setRound2(r2);
      
      if (r2?.active_participant_id) {
        fetchParticipant(r2.active_participant_id).then(setSelectedParticipant);
      }
    }
    setLoading(false);
  };

  const fetchParticipants = async () => {
    const { data } = await supabase.from('participants').select('*').order('roll_no');
    if (data) setParticipants(data);
  };

  const fetchParticipant = async (id) => {
    const { data } = await supabase.from('participants').select('*').eq('id', id).single();
    return data;
  };

  const setRoundStatus = async (round, status, extra = {}) => {
    let error = null;

    if (status === 'active') {
      const result = await supabase.rpc('start_round', {
        p_round: round,
        p_active_participant_id: extra.active_participant_id || null,
      });
      error = result.error;
    } else {
      const updates = { status, ...extra };
      const result = await supabase
        .from('round_state')
        .update(updates)
        .eq('round', round);
      error = result.error;
    }

    if (error) {
      showToast(`Failed to update Round ${round}`, 'error');
    } else {
      showToast(`Round ${round} set to ${status}`);
      fetchState(); // Fallback if realtime is slow
    }
  };

  const startRound2 = () => {
    if (!selectedParticipant) {
      showToast('Select a participant first', 'error');
      return;
    }
    setRoundStatus(2, 'active', { active_participant_id: selectedParticipant.id });
  };

  const renderRoundCard = (roundObj, roundNum, title, controls) => {
    if (!roundObj) return null;

    const isActive = roundObj.status === 'active';
    const isCompleted = roundObj.status === 'completed';

    return (
      <div className={`rc-card card ${isActive ? 'rc-card--active' : 'card--solid'}`}>
        <div className="rc-header">
          <div>
            <h3>{title}</h3>
            <span className={`badge badge--${roundObj.status}`}>
              {roundObj.status.toUpperCase()}
            </span>
          </div>
          <div className="rc-meta">
            {isActive && (
              <span className="rc-question-meta">
                Question {roundObj.current_question_index + 1}
              </span>
            )}
          </div>
        </div>

        <div className="rc-body">
          {controls}
        </div>

        <div className="rc-actions">
          {roundObj.status !== 'inactive' && (
            <button 
              className="btn btn-secondary btn-sm" 
              onClick={() => {
                if (window.confirm(`Reset Round ${roundNum} to inactive? This stops the round immediately.`)) {
                  setRoundStatus(roundNum, 'inactive');
                }
              }}
            >
              Reset to Inactive
            </button>
          )}
        </div>
      </div>
    );
  };

  const filteredParticipants = participants.filter((p) => {
    const q = search.toLowerCase();
    return p.roll_no.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
  });

  if (loading) return <div className="rc-loading">Loading round state…</div>;

  return (
    <div className="rc">
      <div className="rc-grid">
        
        {/* Round 1 */}
        {renderRoundCard(round1, 1, 'Round 1: Fastest Finger First', (
          <div className="rc-control-box">
            <p className="rc-desc">
              Synchronized round for all participants. Activating will immediately start Question 1 for everyone connected.
            </p>
            <button 
              className={`btn ${round1?.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => {
                if (round1?.status === 'active') {
                  if (window.confirm('End Round 1 early?')) setRoundStatus(1, 'completed');
                } else {
                  if (window.confirm('Start Round 1 now?')) setRoundStatus(1, 'active');
                }
              }}
            >
              {round1?.status === 'active' ? 'End Round 1' : 'Start Round 1'}
            </button>
          </div>
        ))}

        {/* Round 2 */}
        {renderRoundCard(round2, 2, 'Round 2: Hot Seat', (
          <div className="rc-control-box">
            <p className="rc-desc">
              Select one participant to play Round 2. Only this participant will see active questions.
            </p>
            
            <div className="rc-hs-select">
              <label className="form-label">Active Participant</label>
              
              {round2?.status === 'active' || round2?.status === 'completed' ? (
                <div className="rc-selected-player">
                  <span className="rc-player-roll">{selectedParticipant?.roll_no}</span>
                  <span className="rc-player-name">{selectedParticipant?.name}</span>
                </div>
              ) : (
                <div className="rc-participant-search">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search participant…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  
                  {search && (
                    <div className="rc-search-results">
                      {filteredParticipants.slice(0, 5).map(p => (
                        <div 
                          key={p.id} 
                          className={`rc-search-item ${selectedParticipant?.id === p.id ? 'rc-search-item--selected' : ''}`}
                          onClick={() => {
                            setSelectedParticipant(p);
                            setSearch('');
                          }}
                        >
                          <span className="rc-item-roll">{p.roll_no}</span>
                          <span className="rc-item-name">{p.name || '—'}</span>
                        </div>
                      ))}
                      {filteredParticipants.length === 0 && (
                        <div className="rc-search-empty">No matches</div>
                      )}
                    </div>
                  )}
                  
                  {selectedParticipant && !search && (
                    <div className="rc-selected-preview">
                      Selected: <strong>{selectedParticipant.roll_no}</strong> {selectedParticipant.name}
                      <button className="btn-icon" onClick={() => setSelectedParticipant(null)}>✕</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button 
              className={`btn ${round2?.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => {
                if (round2?.status === 'active') {
                  if (window.confirm('End Round 2 early?')) setRoundStatus(2, 'completed');
                } else {
                  if (window.confirm(`Start Round 2 for ${selectedParticipant?.roll_no}?`)) {
                    startRound2();
                  }
                }
              }}
              disabled={round2?.status !== 'active' && !selectedParticipant}
            >
              {round2?.status === 'active' ? 'End Round 2' : 'Start Round 2'}
            </button>
          </div>
        ))}
      </div>

      {toast && (
        <div className={`toast toast--${toast.type}`}>{toast.message}</div>
      )}

      <style>{`
        .rc-loading {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--serene-seafoam);
        }

        .rc-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-lg);
          max-width: 800px;
          margin: 0 auto;
        }

        .rc-card {
          display: flex;
          flex-direction: column;
        }

        .rc-card--active {
          border-color: var(--ocean-aqua);
          box-shadow: 0 0 0 2px rgba(36,184,175,0.2), var(--shadow-card);
        }

        .rc-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: var(--space-md);
          border-bottom: 1px solid rgba(36,184,175,0.1);
          padding-bottom: var(--space-sm);
        }

        .rc-header h3 {
          font-size: 20px;
          margin-bottom: var(--space-xs);
        }

        .rc-meta {
          text-align: right;
        }

        .rc-question-meta {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--ocean-aqua);
          font-size: 16px;
        }

        .rc-body {
          flex: 1;
        }

        .rc-desc {
          color: var(--serene-seafoam);
          font-size: 14px;
          margin-bottom: var(--space-lg);
          line-height: 1.5;
        }

        .rc-control-box {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .rc-hs-select {
          width: 100%;
          margin-bottom: var(--space-lg);
          background: rgba(16, 43, 86, 0.4);
          padding: var(--space-md);
          border-radius: var(--radius-md);
          border: 1px solid rgba(36,184,175,0.1);
        }

        .rc-participant-search {
          position: relative;
          margin-top: var(--space-xs);
        }

        .rc-participant-search input {
          width: 100%;
        }

        .rc-search-results {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--deep-midnight);
          border: 1px solid var(--twilight-teal);
          border-radius: var(--radius-md);
          margin-top: 4px;
          max-height: 200px;
          overflow-y: auto;
          z-index: 10;
          box-shadow: var(--shadow-card);
        }

        .rc-search-item {
          padding: 10px 14px;
          display: flex;
          gap: 12px;
          cursor: pointer;
          border-bottom: 1px solid rgba(36,184,175,0.1);
        }

        .rc-search-item:hover {
          background: rgba(36,184,175,0.08);
        }

        .rc-search-item--selected {
          background: rgba(36,184,175,0.15);
        }

        .rc-item-roll {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          color: var(--cloud-white);
        }

        .rc-item-name {
          color: var(--serene-seafoam);
        }

        .rc-search-empty {
          padding: 10px 14px;
          color: var(--serene-seafoam);
          font-size: 13px;
          text-align: center;
        }

        .rc-selected-preview {
          margin-top: var(--space-sm);
          padding: 8px 12px;
          background: rgba(36,184,175,0.1);
          border-radius: var(--radius-sm);
          font-size: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .rc-selected-player {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: var(--space-xs);
          padding: 12px;
          background: rgba(36,184,175,0.1);
          border: 1px solid var(--twilight-teal);
          border-radius: var(--radius-md);
        }

        .rc-player-roll {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 18px;
          color: var(--ocean-aqua);
        }

        .rc-player-name {
          font-size: 16px;
          font-weight: 500;
        }

        .rc-actions {
          margin-top: var(--space-xl);
          padding-top: var(--space-md);
          border-top: 1px solid rgba(36,184,175,0.1);
          display: flex;
          justify-content: flex-end;
        }

        @media (min-width: 768px) {
          .rc-grid {
            grid-template-columns: 1fr 1fr;
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
