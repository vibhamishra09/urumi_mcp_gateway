import React, { useEffect, useState, useContext } from 'react';
import { api } from '../lib/api.js';
import { AuthCtx } from '../App.jsx';

function AddServerModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ slug: '', name: '', url: '', auth_type: 'none', auth_header_name: '', credential: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try { const s = await api.addServer(form); onAdded(s); onClose(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Add MCP Server</div>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Slug (unique identifier)</label>
              <input className="form-input" value={form.slug} onChange={e => setForm(f=>({...f,slug:e.target.value}))} placeholder="my-server" pattern="[a-z0-9\-]+" required />
            </div>
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="My MCP Server" required />
            </div>
            <div className="form-group">
              <label className="form-label">URL (base URL, without /mcp)</label>
              <input className="form-input" type="url" value={form.url} onChange={e => setForm(f=>({...f,url:e.target.value}))} placeholder="http://my-server:3000" required />
            </div>
            <div className="form-group">
              <label className="form-label">Authentication</label>
              <select className="form-select" value={form.auth_type} onChange={e => setForm(f=>({...f,auth_type:e.target.value}))}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="header">Custom Header</option>
              </select>
            </div>
            {form.auth_type === 'header' && (
              <div className="form-group">
                <label className="form-label">Header Name</label>
                <input className="form-input" value={form.auth_header_name} onChange={e => setForm(f=>({...f,auth_header_name:e.target.value}))} placeholder="X-API-Key" />
              </div>
            )}
            {form.auth_type !== 'none' && (
              <div className="form-group">
                <label className="form-label">Credential</label>
                <input className="form-input" type="password" value={form.credential} onChange={e => setForm(f=>({...f,credential:e.target.value}))} placeholder="Token value" />
              </div>
            )}
            <div className="modal-footer" style={{ padding: 0, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner" style={{width:14,height:14}}/> : 'Add Server'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function Servers() {
  const { user } = useContext(AuthCtx);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expanding, setExpanding] = useState({});

  const load = () => api.listServers().then(setServers).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggleExpand = (id) => setExpanding(e => ({...e, [id]: !e[id]}));

  const handleEnable = async (server) => {
    await api.updateServer(server.id, { is_enabled: !server.is_enabled });
    setServers(ss => ss.map(s => s.id === server.id ? {...s, is_enabled: !server.is_enabled, status: !server.is_enabled ? 'unknown' : 'disabled'} : s));
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleDelete = async (id) => {
    try {
      await api.deleteServer(id);
      setConfirmDeleteId(null);
      setServers(ss => ss.filter(s => s.id !== id));
    } catch (e) {
      alert('Failed to delete server: ' + e.message);
    }
  };

  const handleRefresh = async (server) => {
    try {
      const result = await api.refreshServer(server.id);
      setServers(ss => ss.map(s => s.id === server.id ? {...s, status: 'connected', tools_cache: result.tools} : s));
    } catch (e) {
      setServers(ss => ss.map(s => s.id === server.id ? {...s, status: 'unreachable'} : s));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontSize:18,fontWeight:700}}>MCP Servers</h1>
          <p className="text-muted text-sm">Manage upstream MCP servers connected to the gateway</p>
        </div>
        {user?.role === 'admin' && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Server</button>
        )}
      </div>

      <div className="page-content">
        {loading ? <div className="spinner" /> : servers.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">🖥️</div><p>No MCP servers registered</p></div>
        ) : servers.map(server => (
          <div key={server.id} className="card mb-4">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{server.name}</div>
                  <span className={`badge badge-${server.status || 'unknown'}`}>
                    {server.status === 'connected' ? '●' : server.status === 'unreachable' ? '●' : '○'} {server.status || 'unknown'}
                  </span>
                  {!server.is_enabled && <span className="badge badge-disabled">disabled</span>}
                </div>
                <div className="mono text-muted" style={{ fontSize: 12, marginBottom: 8 }}>{server.url}/mcp</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Slug: <code className="mono">{server.slug}</code></span>
                  <span>Auth: {server.auth_type}</span>
                  <span>{server.tools_cache?.length || 0} tools</span>
                  {server.status_checked_at && <span>Checked: {new Date(server.status_checked_at).toLocaleTimeString()}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => handleRefresh(server)} title="Refresh tools">↻</button>
                <button className="btn btn-sm btn-secondary" onClick={() => toggleExpand(server.id)}>
                  {expanding[server.id] ? 'Hide Tools' : 'Show Tools'}
                </button>
                {user?.role === 'admin' && <>
                  <button className={`btn btn-sm ${server.is_enabled ? 'btn-secondary' : 'btn-success'}`} onClick={() => handleEnable(server)}>
                    {server.is_enabled ? 'Disable' : 'Enable'}
                  </button>
                  {confirmDeleteId === server.id ? (
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(server.id)}>Delete</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteId(null)}>✕</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteId(server.id)}>Remove</button>
                  )}
                </>}
              </div>
            </div>

            {expanding[server.id] && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Available Tools</div>
                {(!server.tools_cache || server.tools_cache.length === 0) ? (
                  <p className="text-muted text-sm">No tools cached. Click ↻ to refresh.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {server.tools_cache.map(t => {
                      const isRestricted = ['create_product', 'update_order_status'].includes(t.name) && server.slug === 'woocommerce';
                      return (
                        <div key={t.name} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--primary)' }}>{server.slug}__{t.name}</span>
                          {isRestricted && <span className="badge badge-warning" style={{ fontSize: 10, padding: '1px 5px' }}>Admin Only</span>}
                          {t.description && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {t.description.substring(0, 60)}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} onAdded={s => { setServers(ss => [...ss, s]); load(); }} />}
    </div>
  );
}
