import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function StatCard({ value, label, icon, color }) {
  return (
    <div className="stat-card" style={{ '--accent': color }}>
      <div className="stat-icon" style={{ fontSize: 48 }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.listServers(), api.listAudit({ limit: 10 })])
      .then(([svrs, auditData]) => { setServers(svrs); setAudit(auditData.logs || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const connected = servers.filter(s => s.status === 'connected').length;
  const totalTools = servers.reduce((acc, s) => acc + (s.tools_cache?.length || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>Dashboard</h1>
          <p className="text-muted text-sm">MCP Gateway overview</p>
        </div>
      </div>
      <div className="page-content">
        <div className="grid-4 mb-6">
          <StatCard value={servers.length} label="MCP Servers" icon="🖥️" color="var(--primary)" />
          <StatCard value={connected} label="Connected" icon="✅" color="var(--success)" />
          <StatCard value={totalTools} label="Total Tools" icon="🔧" color="var(--purple)" />
          <StatCard value={audit.length > 0 ? audit[0]?.tool_name || '—' : '—'} label="Last Tool Call" icon="⚡" color="var(--warning)" />
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <div className="card-title">MCP Servers</div>
              <a href="/servers" style={{ fontSize: 12, color: 'var(--primary)' }}>View all →</a>
            </div>
            {loading ? <div className="spinner" /> : servers.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{s.slug}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.tools_cache?.length || 0} tools</span>
                  <span className={`badge badge-${s.status || 'unknown'}`}>{s.status || 'unknown'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Recent Tool Calls</div>
              <a href="/audit" style={{ fontSize: 12, color: 'var(--primary)' }}>View all →</a>
            </div>
            {loading ? <div className="spinner" /> : audit.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">📋</div><p>No tool calls yet</p></div>
            ) : audit.slice(0, 8).map(log => (
              <div key={log.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="mono" style={{ color: 'var(--purple)' }}>{log.tool_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>by {log.username}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.duration_ms}ms</span>
                  <span style={{ fontSize: 12 }}>{log.success ? '✅' : '❌'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
