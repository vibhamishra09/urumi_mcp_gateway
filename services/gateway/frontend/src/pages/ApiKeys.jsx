import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => api.listKeys().then(setKeys).catch(console.error);
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const k = await api.createKey(label || 'My API Key');
      setNewKey(k.key);
      setLabel('');
      load();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  const [confirmId, setConfirmId] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const hasUsers = keys.some(k => k.username);

  const revoke = async (id) => {
    setRevoking(true);
    try {
      await api.revokeKey(id);
      setConfirmId(null);
      await load();
    } catch (e) {
      alert('Failed to revoke key: ' + e.message);
    } finally {
      setRevoking(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(newKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const gatewayUrl = window.location.origin + '/mcp';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontSize:18,fontWeight:700}}>API Keys</h1>
          <p className="text-muted text-sm">Generate and manage keys to connect external MCP clients</p>
        </div>
      </div>
      <div className="page-content">

        {/* Connection info card */}
        <div className="card mb-6" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))', borderColor: 'rgba(59,130,246,0.3)' }}>
          <div className="card-title" style={{ marginBottom: 12 }}>🔌 Connect Your MCP Client</div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>Add this gateway to Claude Code, Cursor, or MCP Inspector using:</p>
          <div className="grid-2">
            <div>
              <div className="form-label">Gateway MCP Endpoint</div>
              <div className="key-display" style={{ color: 'var(--info)' }}>{gatewayUrl}</div>
            </div>
            <div>
              <div className="form-label">Authentication Header</div>
              <div className="key-display" style={{ color: 'var(--text-dim)' }}>x-api-key: {'<your-key>'}</div>
            </div>
          </div>
        </div>

        {/* Generate new key */}
        <div className="card mb-6">
          <div className="card-title" style={{marginBottom:16}}>Generate New API Key</div>
          {newKey && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>⚠️ Save this key — it won't be shown again!</div>
              <div className="key-display" style={{ cursor: 'pointer' }} onClick={copy}>{newKey}</div>
              <button className="btn btn-sm btn-success" style={{ marginTop: 8 }} onClick={copy}>
                {copied ? '✅ Copied!' : '📋 Copy Key'}
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="form-input" style={{ maxWidth: 300 }} value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Label (e.g. Cursor, Claude Code)" />
            <button className="btn btn-primary" onClick={generate} disabled={loading}>
              {loading ? <span className="spinner" style={{width:14,height:14}}/> : '+ Generate Key'}
            </button>
          </div>
        </div>

        {/* Key list */}
        <div className="card">
          <div className="card-title" style={{marginBottom:16}}>Team & Personal API Keys</div>
          {keys.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">🔑</div><p>No keys yet</p></div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Prefix</th>
                    {hasUsers && <th>User</th>}
                    <th>Label</th>
                    <th>Status</th>
                    <th>Last Used</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map(k => (
                    <tr key={k.id}>
                      <td><code className="mono">{k.key_prefix}…</code></td>
                      {hasUsers && (
                        <td>
                          <span className="badge badge-member">{k.username || 'You'}</span>
                        </td>
                      )}
                      <td>{k.label}</td>
                      <td><span className={`badge ${k.is_active ? 'badge-connected' : 'badge-disabled'}`}>{k.is_active ? 'Active' : 'Revoked'}</span></td>
                      <td className="text-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                      <td className="text-muted">{new Date(k.created_at).toLocaleString()}</td>
                      <td>
                        {k.is_active && (
                          confirmId === k.id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button
                                className="btn btn-sm btn-danger"
                                disabled={revoking}
                                onClick={() => revoke(k.id)}
                              >
                                {revoking ? 'Revoking…' : 'Yes, Revoke'}
                              </button>
                              <button
                                className="btn btn-sm btn-secondary"
                                disabled={revoking}
                                onClick={() => setConfirmId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => setConfirmId(k.id)}
                            >
                              Revoke
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
