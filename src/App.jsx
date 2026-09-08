import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Link } from 'react-router-dom';
import { supabase } from './lib/supabase';

// Styles
import './modules/shared/styles.css';

// Unified login (R1)
import LoginPage from './modules/auth/LoginPage';

// Admin Modules
import AdminLayout from './modules/admin/AdminLayout';

// Participant Modules (Module 3)
import {
  ParticipantHome,
  NetworkCheck,
  getStoredParticipant,
  hasCompletedNetworkCheck,
} from './modules/participant';

// Round 1 Engine (Module 4)
import { Round1Engine } from './modules/round1';

// Round 2 Engine (Module 5)
import { Round2Engine } from './modules/round2';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Participant state (Module 3)
  const [participant, setParticipant] = useState(() => getStoredParticipant());

  // Network check is per browser session, not per login (R2)
  const [networkChecked, setNetworkChecked] = useState(() => {
    const stored = getStoredParticipant();
    return stored ? hasCompletedNetworkCheck(stored.participant_id) : false;
  });

  useEffect(() => {
    // A stored admin session whose refresh token has expired or been used
    // makes getSession() POST /auth/v1/token?grant_type=refresh_token, which
    // answers 400 ("Refresh token is not valid"). supabase-js keeps the dead
    // token in localStorage, so that 400 reappears on every reload and looks
    // exactly like a failed sign-in in the console. Clear it once, here.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.warn('Discarding stale Supabase session:', error.message);
        supabase.auth.signOut().catch(() => {});
        setSession(null);
      } else {
        setSession(session);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleParticipantLogin = useCallback((p) => {
    setNetworkChecked(false);
    setParticipant(p);
  }, []);

  const handleParticipantLogout = useCallback(() => {
    setParticipant(null);
    setNetworkChecked(false);
  }, []);

  const handleNetworkCheckDone = useCallback(() => {
    setNetworkChecked(true);
  }, []);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#A8E6CF' }}>Starting up...</div>;
  }

  const needsNetworkCheck = participant && !networkChecked;

  return (
    <BrowserRouter>
      <Routes>
        {/* ── Login (R1) — one page, participant + admin tabs ── */}
        <Route
          path="/admin/login"
          element={
            session ? (
              <Navigate to="/admin" replace />
            ) : (
              <LoginPage
                initialTab="admin"
                onParticipantLogin={handleParticipantLogin}
                onAdminLogin={setSession}
              />
            )
          }
        />

        {/* ── Admin ── */}
        <Route
          path="/admin/*"
          element={
            session ? (
              <AdminLayout session={session} onLogout={() => setSession(null)} />
            ) : (
              <Navigate to="/admin/login" replace />
            )
          }
        />

        {/* ── Post-login network check (R2 / R3) ── */}
        <Route
          path="/network-check"
          element={
            participant ? (
              <NetworkCheckWithNav
                participant={participant}
                onDone={handleNetworkCheckDone}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        {/* ── Round 1 (Module 4) ── */}
        <Route
          path="/round/1"
          element={
            !participant ? (
              <Navigate to="/" replace />
            ) : needsNetworkCheck ? (
              <Navigate to="/network-check" replace />
            ) : (
              <Round1Engine participant={participant} />
            )
          }
        />

        {/* ── Round 2 (Module 5) ── */}
        <Route
          path="/round/2"
          element={
            !participant ? (
              <Navigate to="/" replace />
            ) : needsNetworkCheck ? (
              <Navigate to="/network-check" replace />
            ) : (
              <Round2Engine participant={participant} />
            )
          }
        />

        {/* ── Participant home (Module 3) ── */}
        <Route
          path="/"
          element={
            !participant ? (
              <LoginPage
                initialTab="participant"
                onParticipantLogin={handleParticipantLogin}
                onAdminLogin={setSession}
              />
            ) : needsNetworkCheck ? (
              <Navigate to="/network-check" replace />
            ) : (
              <ParticipantHomeWithNav
                participant={participant}
                onLogout={handleParticipantLogout}
              />
            )
          }
        />

        {/* ── Catch-all (ISSUES 4.6) ── */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}


/**
 * Wrapper to inject useNavigate into ParticipantHome's onEnterRound callback.
 * Keeps ParticipantHome free from router coupling.
 */
function ParticipantHomeWithNav({ participant, onLogout }) {
  const navigate = useNavigate();

  const handleEnterRound = useCallback((round) => {
    navigate(`/round/${round}`);
  }, [navigate]);

  return (
    <ParticipantHome
      participant={participant}
      onLogout={onLogout}
      onEnterRound={handleEnterRound}
    />
  );
}


/**
 * Passing the network check sends the participant straight to Round 1 (R3);
 * continuing after a failure drops them on the home screen instead.
 */
function NetworkCheckWithNav({ participant, onDone }) {
  const navigate = useNavigate();

  const handlePass = useCallback(() => {
    onDone();
    navigate('/round/1', { replace: true });
  }, [onDone, navigate]);

  const handleContinue = useCallback(() => {
    onDone();
    navigate('/', { replace: true });
  }, [onDone, navigate]);

  return (
    <NetworkCheck
      participant={participant}
      onPass={handlePass}
      onContinue={handleContinue}
    />
  );
}


function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <h1 style={{ fontFamily: "'Poppins', sans-serif", fontSize: '28px' }}>Page not found</h1>
      <p style={{ color: 'var(--serene-seafoam)' }}>
        That link doesn’t lead anywhere in this quiz.
      </p>
      <Link to="/" className="btn btn-primary" style={{ marginTop: '8px' }}>
        Back to start
      </Link>
    </div>
  );
}
