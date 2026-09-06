import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Module 3 — Participant Identification
 *
 * Landing screen: enter roll_no + PIN.
 *   - If pin_hash is null → claim (hash & save), return participant_id.
 *   - If pin_hash exists → compare; reject on mismatch.
 *   - On success, store participant_id + name in localStorage.
 */

const STORAGE_KEY = 'kbh_participant';

export function getStoredParticipant() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearStoredParticipant() {
  localStorage.removeItem(STORAGE_KEY);
}

export default function ParticipantLogin({ onLoginSuccess }) {
  const [rollNo, setRollNo] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null); // { action: 'claimed' | 'verified', name }

  // Check localStorage on mount
  useEffect(() => {
    const stored = getStoredParticipant();
    if (stored?.participant_id) {
      onLoginSuccess(stored);
    }
  }, [onLoginSuccess]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(null);
    setLoading(true);

    const trimmedRoll = rollNo.trim().toUpperCase();
    const trimmedPin = pin.trim();

    if (!trimmedRoll) {
      setError('Please enter your roll number');
      setLoading(false);
      return;
    }

    if (!trimmedPin || trimmedPin.length < 4) {
      setError('PIN must be at least 4 digits');
      setLoading(false);
      return;
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('claim_or_verify_pin', {
        p_roll_no: trimmedRoll,
        p_pin: trimmedPin,
      });

      if (rpcError) {
        setError(rpcError.message || 'Server error. Please try again.');
        return;
      }

      if (!data.success) {
        setError(data.error || 'Login failed');
        return;
      }

      // Store in localStorage
      const participant = {
        participant_id: data.participant_id,
        name: data.name,
        roll_no: trimmedRoll,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(participant));

      // Brief success flash before navigating
      setSuccess({
        action: data.action,
        name: data.name || trimmedRoll,
      });

      setTimeout(() => {
        onLoginSuccess(participant);
      }, 1200);
    } catch (err) {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="participant-login-container">
      <div className="participant-login-card card card--solid">
        {/* Header */}
        <div className="participant-login-header">
          <div className="participant-login-logo">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="26" stroke="var(--ocean-aqua)" strokeWidth="2" fill="none" />
              <text
                x="28" y="34"
                textAnchor="middle"
                fontFamily="Poppins, sans-serif"
                fontWeight="700"
                fontSize="22"
                fill="var(--ocean-aqua)"
              >
                ₹
              </text>
            </svg>
          </div>
          <h1 className="participant-login-title">Kaun Banega<br />Hazaarpati</h1>
          <p className="participant-login-subtitle">Enter your roll number and PIN to begin</p>
        </div>

        {/* Success state */}
        {success ? (
          <div className="participant-login-success">
            <div className="success-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" fill="var(--success-green)" opacity="0.15" />
                <circle cx="24" cy="24" r="22" stroke="var(--success-green)" strokeWidth="2" />
                <path
                  d="M15 24l6 6 12-12"
                  stroke="var(--success-green)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="checkmark-path"
                />
              </svg>
            </div>
            <p className="success-text">
              {success.action === 'claimed'
                ? `Welcome, ${success.name}! PIN set successfully.`
                : `Welcome back, ${success.name}!`}
            </p>
          </div>
        ) : (
          /* Login form */
          <form onSubmit={handleSubmit} className="participant-login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="participant-roll">
                Roll Number
              </label>
              <input
                id="participant-roll"
                type="text"
                className="form-input"
                placeholder="e.g. CS001"
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
                required
                autoFocus
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="participant-pin">
                PIN
              </label>
              <input
                id="participant-pin"
                type="password"
                className="form-input"
                placeholder="4+ digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
                inputMode="numeric"
                autoComplete="off"
              />
              <p className="pin-hint">
                First time? Your PIN will be saved for future logins.
              </p>
            </div>

            {error && (
              <div className="participant-login-error">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="var(--danger-red)" strokeWidth="1.5" />
                  <path d="M8 4.5v4M8 10.5v.5" stroke="var(--danger-red)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary participant-login-submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Verifying…
                </>
              ) : (
                'Enter Quiz'
              )}
            </button>
          </form>
        )}
      </div>

      <style>{`
        .participant-login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-xl);
        }

        .participant-login-card {
          width: 100%;
          max-width: 440px;
          padding: 44px 40px;
        }

        /* Header */
        .participant-login-header {
          text-align: center;
          margin-bottom: var(--space-xl);
        }

        .participant-login-logo {
          margin-bottom: var(--space-md);
          animation: logoPulse 2s ease-in-out infinite;
        }

        @keyframes logoPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.9; }
        }

        .participant-login-title {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 28px;
          line-height: 1.2;
          color: var(--cloud-white);
          margin-bottom: var(--space-sm);
        }

        .participant-login-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--serene-seafoam);
          font-weight: 400;
        }

        /* Form */
        .participant-login-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
        }

        .pin-hint {
          font-size: 12px;
          color: rgba(240, 244, 248, 0.4);
          margin-top: 4px;
          font-style: italic;
        }

        .participant-login-error {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          padding: 10px 14px;
          background: var(--danger-red-soft);
          border-radius: var(--radius-sm);
          font-size: 13px;
          color: var(--danger-red);
        }

        .participant-login-submit {
          width: 100%;
          margin-top: var(--space-sm);
          padding: 14px;
          font-size: 15px;
        }

        /* Spinner */
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid transparent;
          border-top-color: var(--deep-midnight);
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Success state */
        .participant-login-success {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-md);
          padding: var(--space-xl) 0;
          animation: fadeInUp 0.4s ease;
        }

        .success-icon {
          animation: scaleIn 0.5s ease;
        }

        @keyframes scaleIn {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        @keyframes fadeInUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .checkmark-path {
          stroke-dasharray: 30;
          stroke-dashoffset: 30;
          animation: drawCheck 0.5s ease 0.3s forwards;
        }

        @keyframes drawCheck {
          to { stroke-dashoffset: 0; }
        }

        .success-text {
          font-family: 'Inter', sans-serif;
          font-size: 16px;
          font-weight: 500;
          color: var(--success-green);
          text-align: center;
        }

        /* Mobile */
        @media (max-width: 480px) {
          .participant-login-card {
            padding: 32px 24px;
          }

          .participant-login-title {
            font-size: 24px;
          }
        }
      `}</style>
    </div>
  );
}
