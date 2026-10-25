import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'member' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try { const u = await api.createUser(form); onCreated(u); onClose(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Invite Team Member</div>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input className="form-input" value={form.username} onChange={e => setForm(f=>({...f,username:e.target.value}))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={form.password} onChange={e => setForm(f=>({...f,password:e.target.value}))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-select" value={form.role} onChange={e => setForm(f=>({...f,role:e.target.value}))}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="modal-footer" style={{padding:0,marginTop:16}}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>Invite</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [keys, setKeys] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandUser, setExpandUser] = useState(null);

  const load = () => api.listUsers().then(setUsers).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const loadUserKeys = async (userId) => {
    if (expandUser === userId) { setExpandUser(null); return; }
    const k = await api.listUserKeys(userId);
    setKeys(ks => ({...ks, [userId]: k}));
    setExpandUser(userId);
  };

  const [confirmKeyId, setConfirmKeyId] = useState(null);
  const [revokingKey, setRevokingKey] = useState(false);
  const [confirmUserId, setConfirmUserId] = useState(null);

  const revokeKey = async (userId, keyId) => {
    setRevokingKey(true);
    try {
      await api.revokeUserKey(userId, keyId);
      setConfirmKeyId(null);
      const k = await api.listUserKeys(userId);
      setKeys(ks => ({...ks, [userId]: k}));
    } catch (e) {
      alert('Failed to revoke key: ' + e.message);
    } finally {
      setRevokingKey(false);
    }
  };

  const deleteUser = async (id) => {
    try {
      await api.deleteUser(id);
      setConfirmUserId(null);
      setUsers(us => us.filter(u => u.id !== id));
    } catch (e) {
      alert('Failed to delete user: ' + e.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontSize:18,fontWeight:700}}>Team Members</h1>
          <p className="text-muted text-sm">Manage users and their API keys</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Invite Member</button>
      </div>
      <div className="page-content">
        {loading ? <div className="spinner" /> : (
          <div className="card">
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <React.Fragment key={u.id}>
                      <tr>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg, var(--primary), var(--purple))', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white', flexShrink: 0 }}>
                              {u.username[0].toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 500, color: 'var(--text)' }}>{u.username}</span>
                          </div>
                        </td>
                        <td className="text-muted">{u.email}</td>
                        <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                        <td className="text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm btn-secondary" onClick={() => loadUserKeys(u.id)}>
                              {expandUser === u.id ? 'Hide Keys' : 'View Keys'}
                            </button>
                            {confirmUserId === u.id ? (
                              <div style={{ display: 'inline-flex', gap: 4 }}>
                                <button className="btn btn-sm btn-danger" onClick={() => deleteUser(u.id)}>Delete</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => setConfirmUserId(null)}>✕</button>
                              </div>
                            ) : (
                              <button className="btn btn-sm btn-danger" onClick={() => setConfirmUserId(u.id)}>Remove</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandUser === u.id && (
                        <tr>
                          <td colSpan={5} style={{ padding: '12px 16px', background: 'var(--bg-input)' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>API KEYS</div>
                            {(keys[u.id] || []).length === 0 ? (
                              <p className="text-muted text-sm">No API keys</p>
                            ) : (keys[u.id] || []).map(k => (
                              <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                  <code className="mono" style={{ fontSize: 12 }}>{k.key_prefix}…</code>
                                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{k.label}</span>
                                  <span className={`badge ${k.is_active ? 'badge-connected' : 'badge-disabled'}`}>{k.is_active ? 'active' : 'revoked'}</span>
                                </div>
                                {k.is_active && (
                                  confirmKeyId === k.id ? (
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <button className="btn btn-sm btn-danger" disabled={revokingKey} onClick={() => revokeKey(u.id, k.id)}>
                                        {revokingKey ? 'Revoking…' : 'Yes, Revoke'}
                                      </button>
                                      <button className="btn btn-sm btn-secondary" disabled={revokingKey} onClick={() => setConfirmKeyId(null)}>
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmKeyId(k.id)}>Revoke</button>
                                  )
                                )}
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={u => { setUsers(us => [...us, u]); }} />}
    </div>
  );
}
