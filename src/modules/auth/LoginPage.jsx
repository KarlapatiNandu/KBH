import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { storeParticipant } from '../participant/storage';
import logo from '../../assets/logo.png';

/**
 * Unified login (R1)
 *
 * One page, two tabs:
 *   - Participant — roll_no + PIN via the `claim_or_verify_pin` RPC.
 *     Claims the PIN on first login, verifies it afterwards.
 *   - Admin       — email + password via Supabase Auth.
 *
 * The two auth mechanisms stay separate underneath; only the entry point
 * is shared. `/admin/login` renders this same page with the Admin tab
 * preselected.
 *
 * Props:
 *   onParticipantLogin(participant) — participant signed in
 *   onAdminLogin(session)           — admin signed in
 *   initialTab                      — 'participant' | 'admin'
 */

export default function LoginPage({ onParticipantLogin, onAdminLogin, initialTab = 'participant' }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="login-page">
      <div className="login-hero">
        <img src={logo} alt="Kaun Banega Hazaarpati" className="login-hero-logo" />
        <h1 className="sr-only">Kaun Banega Hazaarpati</h1>
        <p className="login-hero-tagline">Lock kiya jaaye? No pressure — it's only your entire reputation on the line.</p>
      </div>

      <div className="login-page-card card card--solid">
        {/* Role switch */}
        <div className="login-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'participant'}
            className={`login-tab ${tab === 'participant' ? 'login-tab--active' : ''}`}
            onClick={() => setTab('participant')}
          >
            Participant
          </button>
          <button
            role="tab"
            aria-selected={tab === 'admin'}
            className={`login-tab ${tab === 'admin' ? 'login-tab--active' : ''}`}
            onClick={() => setTab('admin')}
          >
            Admin
          </button>
        </div>

        {tab === 'participant' ? (
          <ParticipantForm onSuccess={onParticipantLogin} />
        ) : (
          <AdminForm onSuccess={onAdminLogin} />
        )}
      </div>

      <LoginPageStyles />
    </div>
  );
}


/* ===== Participant tab ===== */

function ParticipantForm({ onSuccess }) {
  const [rollNo, setRollNo] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(null);

    const trimmedRoll = rollNo.trim().toUpperCase();
    const trimmedPin = pin.trim();

    if (!trimmedRoll) {
      setError('Please enter your roll number');
      return;
    }

    if (!trimmedPin || trimmedPin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }

    setLoading(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('claim_or_verify_pin', {
        p_roll_no: trimmedRoll,
        p_pin: trimmedPin,
      });

      if (rpcError) {
        setError(rpcError.message || 'Server error. Please try again.');
        setLoading(false);
        return;
      }

      if (!data.success) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      const participant = {
        participant_id: data.participant_id,
        name: data.name,
        roll_no: trimmedRoll,
      };
      storeParticipant(participant);

      // Brief success flash, then hand off to the network check.
      // `loading` stays true so the form can't be resubmitted mid-flash.
      setSuccess({ action: data.action, name: data.name || trimmedRoll });
      timeoutRef.current = setTimeout(() => onSuccess(participant), 1200);
    } catch {
      setError('Network error. Please check your connection.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-success">
        <div className="login-success-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" fill="var(--success-green)" opacity="0.15" />
            <circle cx="24" cy="24" r="22" stroke="var(--success-green)" strokeWidth="2" />
            <path
              d="M15 24l6 6 12-12"
              stroke="var(--success-green)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="login-check-path"
            />
          </svg>
        </div>
        <p className="login-success-text">
          {success.action === 'claimed'
            ? `Welcome, ${success.name}! PIN set successfully.`
            : `Welcome back, ${success.name}!`}
        </p>
        <p className="login-success-sub">Running network check… fingers crossed for good WiFi karma.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <p className="login-form-hint">Enter your roll number and PIN to begin — no autographs required</p>

      <div className="form-group">
        <label className="form-label" htmlFor="participant-roll">Roll Number</label>
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
        <label className="form-label" htmlFor="participant-pin">PIN</label>
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
        <p className="login-pin-hint">First time? Whatever you type becomes your PIN — choose wisely, there are no do-overs.</p>
      </div>

      {error && <LoginError message={error} />}

      <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
        {loading ? (<><span className="spinner" />Verifying…</>) : 'Enter Quiz'}
      </button>
    </form>
  );
}


/* ===== Admin tab ===== */

function AdminForm({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        // Supabase answers 400 for both "wrong email/password" and "account
        // exists but is unconfirmed". The raw messages are terse enough that
        // the console status code is easier to read than the UI, so say which
        // one it is.
        if (authError.code === 'invalid_credentials') {
          setError('Wrong email or password for this admin account.');
        } else if (authError.code === 'email_not_confirmed') {
          setError('This admin account is not confirmed yet — confirm it in Supabase → Authentication → Users.');
        } else if (authError.code === 'weak_password') {
          // The credentials are correct, but Supabase's password-strength policy
          // rejects the sign-in outright and withholds the session — the raw
          // error otherwise dumps the full response JSON into the UI.
          setError('This admin account\'s password no longer meets the project\'s password policy and can\'t be used to sign in. Reset it in Supabase → Authentication → Users.');
        } else {
          setError(authError.message);
        }
        return;
      }

      if (data.session) {
        onSuccess(data.session);
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <p className="login-form-hint">Host controls — questions, rounds, and the live dashboard. Power responsibly.</p>

      <div className="form-group">
        <label className="form-label" htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          className="form-input"
          placeholder="admin@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="username"
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          className="form-input"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>

      {error && <LoginError message={error} />}

      <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
        {loading ? (<><span className="spinner" />Signing in…</>) : 'Sign In'}
      </button>
    </form>
  );
}


function LoginError({ message }) {
  return (
    <div className="login-error">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="var(--danger-red)" strokeWidth="1.5" />
        <path d="M8 4.5v4M8 10.5v.5" stroke="var(--danger-red)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {message}
    </div>
  );
}


function LoginPageStyles() {
  return (
    <style>{`
      .login-page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-xl);
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

      /* Hero — the logo is the centerpiece, everything else supports it */
      .login-hero {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        margin-bottom: var(--space-lg);
      }

      .login-hero-logo {
        width: clamp(260px, 55vw, 480px);
        height: auto;
        filter:
          drop-shadow(0 16px 40px rgba(0,0,0,0.5))
          drop-shadow(0 0 60px rgba(242,183,5,0.45));
      }

      .login-hero-tagline {
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-style: italic;
        color: var(--pale-gold);
        margin-top: var(--space-sm);
        max-width: 380px;
        opacity: 0.9;
        text-shadow: 0 2px 8px rgba(0,0,0,0.6);
      }

      .login-page-card {
        width: 100%;
        max-width: 440px;
        padding: 40px;
      }

      /* Role tabs */
      .login-tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        background: rgba(11,20,64, 0.6);
        border: 1px solid rgba(242,183,5,0.15);
        border-radius: var(--radius-pill);
        margin-bottom: var(--space-lg);
      }

      .login-tab {
        flex: 1;
        padding: 10px 16px;
        border: none;
        background: transparent;
        color: rgba(240, 244, 248, 0.6);
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        font-size: 14px;
        border-radius: var(--radius-pill);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .login-tab:hover { color: var(--cloud-white); }

      .login-tab--active {
        background: var(--spotlight-gold);
        color: var(--deep-midnight);
      }

      /* Forms */
      .login-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }

      .login-form-hint {
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        color: var(--pale-gold);
        text-align: center;
        margin-bottom: var(--space-xs);
      }

      .login-pin-hint {
        font-size: 12px;
        color: rgba(240, 244, 248, 0.4);
        margin-top: 4px;
        font-style: italic;
      }

      .login-error {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: 10px 14px;
        background: var(--danger-red-soft);
        border-radius: var(--radius-sm);
        font-size: 13px;
        color: var(--danger-red);
      }

      .login-submit {
        width: 100%;
        margin-top: var(--space-sm);
        padding: 14px;
        font-size: 15px;
      }

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid transparent;
        border-top-color: var(--deep-midnight);
        border-radius: 50%;
        animation: loginSpin 0.6s linear infinite;
      }

      @keyframes loginSpin { to { transform: rotate(360deg); } }

      /* Success flash */
      .login-success {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-xl) 0;
        animation: loginFadeInUp 0.4s ease;
      }

      .login-success-icon { animation: loginScaleIn 0.5s ease; }

      @keyframes loginScaleIn {
        from { transform: scale(0.5); opacity: 0; }
        to   { transform: scale(1); opacity: 1; }
      }

      @keyframes loginFadeInUp {
        from { transform: translateY(10px); opacity: 0; }
        to   { transform: translateY(0); opacity: 1; }
      }

      .login-check-path {
        stroke-dasharray: 30;
        stroke-dashoffset: 30;
        animation: loginDrawCheck 0.5s ease 0.3s forwards;
      }

      @keyframes loginDrawCheck { to { stroke-dashoffset: 0; } }

      .login-success-text {
        font-family: 'Inter', sans-serif;
        font-size: 16px;
        font-weight: 500;
        color: var(--success-green);
        text-align: center;
      }

      .login-success-sub {
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        color: var(--pale-gold);
      }

      @media (max-width: 480px) {
        .login-page-card { padding: 32px 24px; }
        .login-hero { margin-bottom: var(--space-md); }
      }
    `}</style>
  );
}
