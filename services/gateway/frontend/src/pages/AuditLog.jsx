import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  const load = async (p = 0) => {
    setLoading(true);
    try {
      const data = await api.listAudit({ limit, offset: p * limit });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(page); }, [page]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{fontSize:18,fontWeight:700}}>Audit Log</h1>
          <p className="text-muted text-sm">{total} total events — every tool call attributed to its user</p>
        </div>
        <button className="btn btn-secondary" onClick={() => load(page)}>↻ Refresh</button>
      </div>
      <div className="page-content">
        <div className="card">
          {loading ? <div className="spinner" /> : logs.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">📋</div><p>No audit events yet</p><p className="text-sm text-muted mt-2">Events appear when tools are called through the gateway</p></div>
          ) : (
            <>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User</th>
                      <th>Server</th>
                      <th>Tool</th>
                      <th>Duration</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id}>
                        <td className="mono text-muted" style={{fontSize:11, whiteSpace:'nowrap'}}>{new Date(log.created_at).toLocaleString()}</td>
                        <td>
                          <span style={{ fontWeight: 500, color: 'var(--text)' }}>{log.username || '—'}</span>
                        </td>
                        <td><code className="mono" style={{color:'var(--info)'}}>{log.server_slug || '—'}</code></td>
                        <td><code className="mono" style={{color:'var(--purple)'}}>{log.tool_name}</code></td>
                        <td className="text-muted mono">{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
                        <td>
                          {log.success ? (
                            <span className="badge badge-connected">✓ success</span>
                          ) : (
                            <span className="badge badge-unreachable" title={log.error_message}>✗ error</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > limit && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 0' }}>
                  <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ padding: '4px 8px', fontSize: 13, color: 'var(--text-muted)' }}>
                    Page {page + 1} of {Math.ceil(total / limit)}
                  </span>
                  <button className="btn btn-secondary btn-sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
