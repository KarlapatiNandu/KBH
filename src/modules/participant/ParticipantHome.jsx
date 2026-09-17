import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { clearStoredParticipant } from './storage';
import logo from '../../assets/logo.png';

/**
 * Module 3 — Participant Home
 *
 * After login, shows two flashcard components:
 *   - Round 1 (Fastest Finger First)
 *   - Round 2 (Hot Seat)
 * Each enabled/disabled based on round_state.status.
 *
 * This component subscribes to round_state via Supabase Realtime.
 */

export default function ParticipantHome({ participant, onLogout, onEnterRound }) {
  const [roundStates, setRoundStates] = useState({ 1: null, 2: null });
  const [loading, setLoading] = useState(true);

  // Fetch initial round states
  useEffect(() => {
    async function fetchRoundStates() {
      const { data, error } = await supabase
        .from('round_state')
        .select('*');

      if (!error && data) {
        const states = { 1: null, 2: null };
        data.forEach((rs) => {
          states[rs.round] = rs;
        });
        setRoundStates(states);
      }
      setLoading(false);
    }

    fetchRoundStates();

    // Subscribe to round_state changes via Realtime
    const channel = supabase
      .channel('participant-round-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_state' },
        (payload) => {
          const updated = payload.new;
          if (updated && updated.round) {
            setRoundStates((prev) => ({
              ...prev,
              [updated.round]: updated,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleLogout = () => {
    clearStoredParticipant();
    onLogout();
  };

  const r1 = roundStates[1];
  const r2 = roundStates[2];

  // Determine if participant is the hot-seat participant for round 2
  const isHotSeat = r2?.active_participant_id === participant.participant_id;

  return (
    <div className="participant-home">
      {/* Header */}
      <header className="participant-header">
        <div className="participant-header-left">
          <div className="participant-avatar">
            {(participant.name || participant.roll_no).charAt(0).toUpperCase()}
          </div>
          <div className="participant-info">
            <span className="participant-name">
              {participant.name || participant.roll_no}
            </span>
            <span className="participant-roll">{participant.roll_no}</span>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
          Logout
        </button>
      </header>

      {/* Title */}
      <div className="participant-home-title">
        <img src={logo} alt="Kaun Banega Hazaarpati" className="participant-home-logo" />
        <h1 className="sr-only">Kaun Banega Hazaarpati</h1>
        <p className="participant-home-subtitle">Select your round to begin — stalling does not improve your odds</p>
      </div>

      {/* Flashcards */}
      {loading ? (
        <div className="participant-loading">
          <span className="spinner-lg" />
          <p>Loading rounds…</p>
        </div>
      ) : (
        <div className="round-cards">
          {/* Round 1 Card */}
          <RoundCard
            round={1}
            title="Fastest Finger First"
            description="Answer questions as fast as you can. All participants play simultaneously — speed matters!"
            icon={
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="16" stroke="var(--spotlight-gold)" strokeWidth="2" fill="none" opacity="0.3" />
                <path d="M18 10v8l5.5 3.3" stroke="var(--spotlight-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            state={r1}
            canEnter={r1?.status === 'active'}
            statusLabel={getStatusLabel(r1?.status)}
            onEnter={() => onEnterRound(1)}
          />

          {/* Round 2 Card */}
          <RoundCard
            round={2}
            title="Hot Seat"
            description={
              isHotSeat
                ? "You're in the Hot Seat! Say your answers to the host — they lock them in for you."
                : "One lucky (or terrified) participant gets the spotlight."
            }
            icon={
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="16" stroke="var(--warning-amber)" strokeWidth="2" fill="none" opacity="0.3" />
                <path d="M18 8l2.5 5 5.5.8-4 3.9.9 5.5L18 20.7l-4.9 2.5.9-5.5-4-3.9 5.5-.8z" stroke="var(--warning-amber)" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
              </svg>
            }
            state={r2}
            canEnter={r2?.status === 'active' && isHotSeat}
            statusLabel={getHotSeatLabel(r2?.status, isHotSeat)}
            onEnter={() => onEnterRound(2)}
            variant="hotseat"
            hotSeat={isHotSeat}
          />
        </div>
      )}

      <style>{`
        .participant-home {
          min-height: 100vh;
          max-width: 700px;
          margin: 0 auto;
          padding: var(--space-xl);
        }

        /* Header */
        .participant-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: var(--space-lg);
          border-bottom: 1px solid rgba(242,183,5,0.15);
          margin-bottom: var(--space-2xl);
        }

        .participant-header-left {
          display: flex;
          align-items: center;
          gap: var(--space-md);
        }

        .participant-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .participant-info {
          display: flex;
          flex-direction: column;
        }

        .participant-name {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 15px;
          color: var(--cloud-white);
        }

        .participant-roll {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--pale-gold);
        }

        /* Title */
        .participant-home-title {
          text-align: center;
          margin-bottom: var(--space-2xl);
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .participant-home-logo {
          width: clamp(180px, 38vw, 260px);
          height: auto;
          margin-bottom: var(--space-md);
          filter:
            drop-shadow(0 10px 28px rgba(0,0,0,0.5))
            drop-shadow(0 0 40px rgba(242,183,5,0.4));
        }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        .participant-home-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          color: var(--pale-gold);
          text-shadow: 0 2px 8px rgba(0,0,0,0.6);
        }

        /* Round cards */
        .round-cards {
          display: flex;
          flex-direction: column;
          gap: var(--space-lg);
        }

        /* Loading */
        .participant-loading {
          text-align: center;
          padding: var(--space-2xl) 0;
          color: var(--pale-gold);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-md);
        }

        .spinner-lg {
          width: 32px;
          height: 32px;
          border: 3px solid transparent;
          border-top-color: var(--spotlight-gold);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Mobile */
        @media (max-width: 480px) {
          .participant-home {
            padding: var(--space-md);
          }
        }
      `}</style>
    </div>
  );
}


/* ===== Round Card Sub-component ===== */

function RoundCard({ round, title, description, icon, state, canEnter, statusLabel, onEnter, variant, hotSeat }) {
  const isActive = state?.status === 'active';
  const isCompleted = state?.status === 'completed';
  const isDisabled = !canEnter;

  return (
    <div className={`round-card ${isActive ? 'round-card--active' : ''} ${isCompleted ? 'round-card--completed' : ''} ${variant === 'hotseat' ? 'round-card--hotseat' : ''} ${hotSeat && isActive ? 'round-card--you' : ''}`}>
      <div className="round-card-top">
        <div className="round-card-icon">{icon}</div>
        <div className="round-card-meta">
          <span className="round-card-label">Round {round}</span>
          <h3 className="round-card-title">{title}</h3>
        </div>
        <span className={`badge badge--${state?.status || 'inactive'}`}>
          {statusLabel}
        </span>
      </div>

      <p className="round-card-desc">{description}</p>

      <button
        className={`btn ${canEnter ? 'btn-primary' : 'btn-secondary'} round-card-btn`}
        disabled={isDisabled}
        onClick={onEnter}
      >
        {isCompleted
          ? 'Completed'
          : canEnter
            ? 'Enter Round →'
            : 'Waiting…'}
      </button>

      <style>{`
        .round-card {
          background: linear-gradient(135deg, rgba(11,20,64,0.92) 0%, rgba(52,24,104,0.88) 100%);
          border: 1.5px solid rgba(242,183,5,0.15);
          border-radius: var(--radius-lg);
          padding: var(--space-lg) 28px 28px;
          transition: all 0.3s ease;
        }

        .round-card--active {
          border-color: var(--spotlight-gold);
          box-shadow: 0 0 24px rgba(242,183,5,0.15);
        }

        .round-card--active.round-card--hotseat {
          border-color: var(--warning-amber);
          box-shadow: 0 0 24px rgba(245,166,35,0.15);
        }

        .round-card--you {
          border-color: var(--success-green);
          box-shadow: 0 0 24px rgba(74,188,132,0.2);
          animation: glowPulse 2s ease-in-out infinite;
        }

        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(74,188,132,0.2); }
          50% { box-shadow: 0 0 36px rgba(74,188,132,0.35); }
        }

        .round-card--completed {
          opacity: 0.7;
        }

        .round-card-top {
          display: flex;
          align-items: center;
          gap: var(--space-md);
          margin-bottom: var(--space-md);
        }

        .round-card-icon {
          flex-shrink: 0;
        }

        .round-card-meta {
          flex: 1;
        }

        .round-card-label {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--pale-gold);
        }

        .round-card-title {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 18px;
          color: var(--cloud-white);
          margin-top: 2px;
        }

        .round-card-desc {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: rgba(240, 244, 248, 0.6);
          line-height: 1.5;
          margin-bottom: var(--space-lg);
        }

        .round-card-btn {
          width: 100%;
          padding: 14px;
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}


/* ===== Helpers ===== */

function getStatusLabel(status) {
  switch (status) {
    case 'active': return '● Live';
    case 'completed': return 'Completed';
    case 'inactive':
    default: return 'Not Started';
  }
}

function getHotSeatLabel(status, isHotSeat) {
  if (status === 'completed') return 'Completed';
  if (status === 'active') {
    return isHotSeat ? '🔥 You\'re Up!' : 'In Progress';
  }
  return 'Not Started';
}
