import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, setToken, clearToken } from './lib/api.js';
import Dashboard from './pages/Dashboard.jsx';
import Servers from './pages/Servers.jsx';
import Users from './pages/Users.jsx';
import AuditLog from './pages/AuditLog.jsx';
import ApiKeys from './pages/ApiKeys.jsx';
import Chat from './pages/Chat.jsx';
import Login from './pages/Login.jsx';

export const AuthCtx = createContext(null);

function Sidebar({ user, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="nav-logo">
        <div className="nav-logo-icon">⚡</div>
        <div>
          <div className="nav-logo-text">Urumi</div>
          <div className="nav-logo-sub">MCP Gateway</div>
        </div>
      </div>

      <nav className="nav-section">
        <div className="nav-section-label">Overview</div>
        <NavLink to="/dashboard" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Dashboard
        </NavLink>
        <NavLink to="/chat" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Chat Agent
        </NavLink>

        <div className="nav-section-label" style={{marginTop: 12}}>MCP</div>
        <NavLink to="/servers" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          MCP Servers
        </NavLink>
        <NavLink to="/api-keys" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          API Keys
        </NavLink>

        {user?.role === 'admin' && <>
          <div className="nav-section-label" style={{marginTop: 12}}>Admin</div>
          <NavLink to="/users" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Team Members
          </NavLink>
          <NavLink to="/audit" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Audit Log
          </NavLink>
        </>}
      </nav>

      <div className="nav-user">
        <div className="nav-avatar">{user?.username?.[0]?.toUpperCase()}</div>
        <div className="nav-user-info">
          <div className="nav-username">{user?.username}</div>
          <div className="nav-role">{user?.role}</div>
        </div>
        <button className="btn btn-sm btn-secondary btn-icon" onClick={onLogout} title="Logout">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </aside>
  );
}

function AppShell({ user, onLogout }) {
  return (
    <div className="layout">
      <Sidebar user={user} onLogout={onLogout} />
      <div className="main-content">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/api-keys" element={<ApiKeys />} />
          <Route path="/users" element={<Users />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('urumi_token');
    if (token) {
      api.me().then(({ user }) => { setUser(user); setLoading(false); })
        .catch(() => { clearToken(); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogin = ({ token, user }) => {
    setToken(token);
    setUser(user);
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  return (
    <AuthCtx.Provider value={{ user, setUser }}>
      <BrowserRouter>
        {user ? (
          <AppShell user={user} onLogout={handleLogout} />
        ) : (
          <Routes>
            <Route path="*" element={<Login onLogin={handleLogin} />} />
          </Routes>
        )}
      </BrowserRouter>
    </AuthCtx.Provider>
  );
}
