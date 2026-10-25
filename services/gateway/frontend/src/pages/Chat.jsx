import React, { useState, useRef, useEffect, useContext } from 'react';
import { api } from '../lib/api.js';
import { AuthCtx } from '../App.jsx';

export default function Chat() {
  const { user } = useContext(AuthCtx);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '👋 Hi! I\'m your AI assistant with access to WooCommerce, Weather, and Calculator tools. Ask me to create products, check orders, get weather, or calculate anything!', toolCalls: [] }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(ms => [...ms, { role: 'user', content: msg, toolCalls: [] }]);
    setLoading(true);

    // Add a loading placeholder
    setMessages(ms => [...ms, { role: 'assistant', content: '...', toolCalls: [], loading: true }]);

    try {
      const resp = await api.chat(msg, history);
      setMessages(ms => {
        const updated = ms.slice(0, -1); // remove loading placeholder
        return [...updated, { role: 'assistant', content: resp.message, toolCalls: resp.toolCalls || [] }];
      });
      setHistory(resp.history || []);
    } catch (e) {
      setMessages(ms => {
        const updated = ms.slice(0, -1);
        return [...updated, { role: 'assistant', content: `❌ Error: ${e.message}`, toolCalls: [] }];
      });
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 style={{fontSize:18,fontWeight:700}}>Chat Agent</h1>
          <p className="text-muted text-sm">Powered by Gemini 1.5 Flash · Tools: WooCommerce, Weather, Calculator</p>
        </div>
        <button className="btn btn-secondary" onClick={() => { setMessages([{ role:'assistant', content:'Chat cleared. How can I help?', toolCalls:[] }]); setHistory([]); }}>
          Clear
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, maxWidth: '80%', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: msg.role === 'user' ? 'linear-gradient(135deg, var(--primary), var(--purple))' : 'var(--bg-card2)', border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none', fontSize: 16 }}>
              {msg.role === 'user' ? user?.username?.[0]?.toUpperCase() : '🤖'}
            </div>
            <div>
              <div style={{ padding: '12px 16px', borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-card)', border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none', color: msg.role === 'user' ? 'white' : 'var(--text)', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {msg.loading ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span className="spinner" style={{width:14,height:14}}/><span style={{fontSize:12,color:'var(--text-muted)'}}>Thinking...</span></div> : msg.content}
              </div>
              {msg.toolCalls?.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {msg.toolCalls.map((tc, j) => (
                    <span key={j} className="tool-badge" title={JSON.stringify(tc.args, null, 2)}>
                      🔧 {tc.tool} {tc.durationMs && <span style={{opacity:0.7}}>({tc.durationMs}ms)</span>}
                      {tc.success === false && <span style={{color:'var(--danger)'}}> ✗</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about products, orders, weather… (Enter to send, Shift+Enter for newline)"
            disabled={loading}
          />
        </div>
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()} style={{ height: 42, padding: '0 20px' }}>
          {loading ? <span className="spinner" style={{width:16,height:16}}/> : '→'}
        </button>
      </div>
    </div>
  );
}
