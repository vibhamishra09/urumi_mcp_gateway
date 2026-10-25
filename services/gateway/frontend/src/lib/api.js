const BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() { return localStorage.getItem('urumi_token'); }
function getHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),
  createKey: (label) => request('POST', '/auth/keys', { label }),
  listKeys: () => request('GET', '/auth/keys'),
  revokeKey: (id) => request('DELETE', `/auth/keys/${id}`),

  // Servers
  listServers: () => request('GET', '/servers'),
  addServer: (data) => request('POST', '/servers', data),
  updateServer: (id, data) => request('PATCH', `/servers/${id}`, data),
  deleteServer: (id) => request('DELETE', `/servers/${id}`),
  refreshServer: (id) => request('POST', `/servers/${id}/refresh`),

  // Users (admin)
  listUsers: () => request('GET', '/users'),
  createUser: (data) => request('POST', '/users', data),
  deleteUser: (id) => request('DELETE', `/users/${id}`),
  listUserKeys: (userId) => request('GET', `/users/${userId}/keys`),
  revokeUserKey: (userId, keyId) => request('DELETE', `/users/${userId}/keys/${keyId}`),

  // Audit
  listAudit: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/audit${qs ? '?' + qs : ''}`);
  },

  // Chat
  chat: (message, history = []) => request('POST', '/chat', { message, history }),
};

export function setToken(token) { localStorage.setItem('urumi_token', token); }
export function clearToken() { localStorage.removeItem('urumi_token'); }
export function isAuthenticated() { return !!getToken(); }
