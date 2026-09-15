import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import QuestionManager from './QuestionManager';
import ParticipantImport from './ParticipantImport';
import RoundControl from './RoundControl';
import LiveDashboard from './LiveDashboard';
import logo from '../../assets/logo.png';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Live Dashboard', icon: '📊' },
  { key: 'questions', label: 'Questions', icon: '❓' },
  { key: 'participants', label: 'Participants', icon: '👥' },
  { key: 'rounds', label: 'Round Control', icon: '🎮' },
];

export default function AdminLayout({ session, onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');

  const handleLogout = async () => {
    await supabase.auth.signOut();
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
            <span className="user-email">{session?.user?.email || 'Admin'}</span>
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
        </header>
        <div className="admin-content">
          {renderContent()}
        </div>
      </main>

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
