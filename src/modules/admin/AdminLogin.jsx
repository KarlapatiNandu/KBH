import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function AdminLogin({ onLoginSuccess }) {
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
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      if (data.session) {
        onLoginSuccess(data.session);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card card card--solid">
        <div className="login-header">
          <div className="login-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="var(--ocean-aqua)" strokeWidth="2" fill="none" />
              <path d="M24 14c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6zm0 16c-4 0-12 2-12 6v2h24v-2c0-4-8-6-12-6z" fill="var(--ocean-aqua)" />
            </svg>
          </div>
          <h2>Admin Login</h2>
          <p className="login-subtitle">Kaun Banega Hazaarpati — Control Panel</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              className="form-input"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
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
            />
          </div>

          {error && (
            <div className="login-error">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="var(--danger-red)" strokeWidth="1.5" />
                <path d="M8 4.5v4M8 10.5v.5" stroke="var(--danger-red)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>

      <style>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-xl);
        }

        .login-card {
          width: 100%;
          max-width: 420px;
          padding: 40px;
        }

        .login-header {
          text-align: center;
          margin-bottom: var(--space-xl);
        }

        .login-icon {
          margin-bottom: var(--space-md);
        }

        .login-header h2 {
          font-size: 24px;
          margin-bottom: var(--space-xs);
        }

        .login-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--serene-seafoam);
          font-weight: 400;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
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
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
