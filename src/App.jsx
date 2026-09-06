import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';

// Styles
import './modules/shared/styles.css';

// Admin Modules
import AdminLogin from './modules/admin/AdminLogin';
import AdminLayout from './modules/admin/AdminLayout';

// Participant Modules (Module 3)
import { ParticipantLogin, ParticipantHome, getStoredParticipant } from './modules/participant';

// Round 1 Engine (Module 4)
import { Round1Engine } from './modules/round1';

// Round 2 Engine (Module 5)
import { Round2Engine } from './modules/round2';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Participant state (Module 3)
  const [participant, setParticipant] = useState(() => getStoredParticipant());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
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
    setParticipant(p);
  }, []);

  const handleParticipantLogout = useCallback(() => {
    setParticipant(null);
  }, []);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#A8E6CF' }}>Starting up...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Admin Routes */}
        <Route 
          path="/admin/login" 
          element={
            session ? <Navigate to="/admin" replace /> : <AdminLogin onLoginSuccess={setSession} />
          } 
        />
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

        {/* Round 1 (Module 4) */}
        <Route 
          path="/round/1" 
          element={
            participant ? (
              <Round1Engine participant={participant} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        {/* Round 2 (Module 5) */}
        <Route 
          path="/round/2" 
          element={
            participant ? (
              <Round2Engine participant={participant} />
            ) : (
              <Navigate to="/" replace />
            )
          } 
        />

        {/* Public Routes — Participant (Module 3) */}
        <Route 
          path="/" 
          element={
            participant ? (
              <ParticipantHomeWithNav
                participant={participant}
                onLogout={handleParticipantLogout}
              />
            ) : (
              <ParticipantLogin onLoginSuccess={handleParticipantLogin} />
            )
          } 
        />
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
