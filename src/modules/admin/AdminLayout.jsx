import { useState } from 'react';
import QuestionManager from './QuestionManager';
import ParticipantImport from './ParticipantImport';
import RoundControl from './RoundControl';
import LiveDashboard from './LiveDashboard';
import SoundBoard from './SoundBoard';
import logo from '../../assets/logo.png';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Live Dashboard', icon: '📊' },
  { key: 'questions', label: 'Questions', icon: '❓' },
  { key: 'participants', label: 'Participants', icon: '👥' },
  { key: 'rounds', label: 'Round Control', icon: '🎮' },
];

// Remembered per browser, so the dock is where the host left it after a refresh.
const SOUND_DOCK_KEY = 'kbh-sound-dock-open';

function readDockOpen() {
  try {
    return localStorage.getItem(SOUND_DOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export default function AdminLayout({ admin, onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [soundOpen, setSoundOpen] = useState(readDockOpen);

  const toggleSound = () => {
    const next = !soundOpen;
    setSoundOpen(next);
    try {
      localStorage.setItem(SOUND_DOCK_KEY, next ? '1' : '0');
    } catch {
      // Private mode / storage off: the dock still works, it just forgets.
    }
  };

  const handleLogout = () => {
    onLogout();
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':  return <LiveDashboard />;
      case 'questions':   return <QuestionManager />;
      case 'participants': return <ParticipantImport />;
      case 'rounds':      return <RoundControl />;
      default:            return <LiveDashboard />;
    }
  };

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <img src={logo} alt="KBH crest" className="sidebar-crest" width="36" height="36" />
          <div>
            <div className="brand-title">KBH Admin</div>
            <div className="brand-subtitle">Mission Control</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`sidebar-link ${activeTab === item.key ? 'sidebar-link--active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="user-email">{admin?.username || 'Admin'}</span>
          </div>
          <button className="btn btn-secondary btn-sm sidebar-logout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
        <header className="admin-topbar">
          <h1 className="admin-page-title">
            {NAV_ITEMS.find((i) => i.key === activeTab)?.icon}{' '}
            {NAV_ITEMS.find((i) => i.key === activeTab)?.label}
          </h1>
          <button
            type="button"
            className={`btn btn-sm ${soundOpen ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleSound}
            aria-pressed={soundOpen}
          >
            🔊 Sounds
          </button>
        </header>
        <div className="admin-content">
          {renderContent()}
        </div>
      </main>

      {/* R17 — the soundboard dock. Sits beside the content on wide screens
          and over it on narrow ones, so Round Control never loses width it
          needs. */}
      {soundOpen && (
        <aside className="admin-sounds" aria-label="Sound board">
          <SoundBoard onClose={toggleSound} />
        </aside>
      )}

      <style>{`
        .admin-layout {
          display: flex;
          min-height: 100vh;
        }

        /* ── Sidebar ── */
        .admin-sidebar {
          width: 260px;
          background: rgba(11,20,64, 0.95);
          border-right: 1px solid rgba(242,183,5,0.1);
          display: flex;
          flex-direction: column;
          padding: var(--space-lg) 0;
          flex-shrink: 0;
        }

        .sidebar-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 var(--space-lg) var(--space-lg);
          border-bottom: 1px solid rgba(242,183,5,0.1);
          margin-bottom: var(--space-md);
        }

        .sidebar-crest {
          border-radius: 50%;
          flex-shrink: 0;
          filter: drop-shadow(0 2px 6px rgba(242,183,5,0.3));
        }

        .brand-title {
          font-family: 'Poppins', sans-serif;
          font-weight: 700;
          font-size: 16px;
          color: var(--cloud-white);
        }

        .brand-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: var(--pale-gold);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .sidebar-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 var(--space-sm);
        }

        .sidebar-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border: none;
          background: transparent;
          color: rgba(240, 244, 248, 0.65);
          font-family: 'Inter', sans-serif;
          font-weight: 500;
          font-size: 14px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
          width: 100%;
        }

        .sidebar-link:hover {
          background: rgba(242,183,5,0.08);
          color: var(--cloud-white);
        }

        .sidebar-link--active {
          background: rgba(242,183,5,0.12);
          color: var(--spotlight-gold);
        }

        .sidebar-icon {
          font-size: 18px;
          width: 24px;
          text-align: center;
        }

        .sidebar-footer {
          padding: var(--space-md) var(--space-lg) 0;
          border-top: 1px solid rgba(242,183,5,0.1);
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }

        .user-email {
          font-size: 12px;
          color: var(--pale-gold);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sidebar-logout {
          width: 100%;
        }

        /* ── Main ── */
        .admin-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }

        .admin-topbar {
          padding: var(--space-lg) var(--space-xl);
          border-bottom: 1px solid rgba(242,183,5,0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-md);
        }

        .admin-page-title {
          font-size: 22px;
          font-weight: 700;
        }

        .admin-content {
          flex: 1;
          padding: var(--space-xl);
          overflow-y: auto;
        }

        /* ── Sound board dock (R17) ── */
        .admin-sounds {
          width: 280px;
          flex-shrink: 0;
          background: rgba(11,20,64, 0.95);
          border-left: 1px solid rgba(242,183,5,0.1);
          overflow-y: auto;
        }

        @media (max-width: 1100px) {
          .admin-sounds {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            z-index: 50;
            max-width: 90vw;
            box-shadow: -12px 0 32px rgba(0,0,0,0.45);
          }
        }

        @media (max-width: 768px) {
          .admin-layout {
            flex-direction: column;
          }
          .admin-sidebar {
            width: 100%;
            flex-direction: row;
            padding: var(--space-sm);
            overflow-x: auto;
          }
          .sidebar-brand,
          .sidebar-footer {
            display: none;
          }
          .sidebar-nav {
            flex-direction: row;
            gap: var(--space-xs);
            padding: 0;
          }
          .sidebar-link {
            padding: 8px 12px;
            font-size: 13px;
            white-space: nowrap;
          }
        }
      `}</style>
    </div>
  );
}
