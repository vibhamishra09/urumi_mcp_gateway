/**
 * MCP upstream client manager
 * 
 * Key design decisions:
 * - Each call creates a new stateless HTTP POST to the upstream server
 * - Tool names are prefixed with server slug to avoid collisions: "woocommerce__list_products"
 * - A slow or dead upstream times out and returns an error; other servers continue working
 * - Upstream credentials stay server-side, never sent to callers
 */
import axios from 'axios';
import { query } from '../db/pool.js';

const UPSTREAM_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_MS || '15000');

// In-memory tools cache, refreshed periodically
let toolsCache = new Map(); // serverId -> { tools: [], cachedAt: Date }
let cacheRefreshInterval = null;

export function prefixToolName(serverSlug, toolName) {
  return `${serverSlug}__${toolName}`;
}

export function parseToolName(prefixedName) {
  const idx = prefixedName.indexOf('__');
  if (idx === -1) return { serverSlug: null, toolName: prefixedName };
  return {
    serverSlug: prefixedName.substring(0, idx),
    toolName: prefixedName.substring(idx + 2),
  };
}

function buildHeaders(server) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (server.auth_type === 'bearer' && server.auth_credential_encrypted) {
    headers['Authorization'] = `Bearer ${server.auth_credential_encrypted}`;
  } else if (server.auth_type === 'header' && server.auth_header_name && server.auth_credential_encrypted) {
    headers[server.auth_header_name] = server.auth_credential_encrypted;
  }
  return headers;
}

function parseMcpResponse(data) {
  if (typeof data === 'object' && data !== null) {
    if (data.result) return data.result;
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.result) return item.result;
      }
    }
    return data;
  }
  if (typeof data === 'string') {
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const jsonStr = line.slice(5).trim();
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.result) return parsed.result;
            if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
          } catch (e) {
            if (e.message && !e.message.startsWith('Unexpected')) throw e;
          }
        }
      }
    }
    try {
      const parsed = JSON.parse(data);
      if (parsed.result) return parsed.result;
      if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    } catch (e) {}
  }
  return null;
}

export async function fetchToolsFromServer(server) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  };
  const resp = await axios.post(`${server.url}/mcp`, body, {
    headers: buildHeaders(server),
    timeout: UPSTREAM_TIMEOUT_MS,
  });
  const res = parseMcpResponse(resp.data);
  if (res?.tools) return res.tools;
  return [];
}

export async function callToolOnServer(server, toolName, args) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
  const resp = await axios.post(`${server.url}/mcp`, body, {
    headers: buildHeaders(server),
    timeout: UPSTREAM_TIMEOUT_MS,
  });
  const res = parseMcpResponse(resp.data);
  if (res) return res;
  throw new Error('Unknown or empty response from upstream');
}

export async function refreshAllToolCaches() {
  const result = await query('SELECT * FROM mcp_servers WHERE is_enabled = TRUE');
  const servers = result.rows;

  await Promise.allSettled(servers.map(async (server) => {
    try {
      const tools = await fetchToolsFromServer(server);
      toolsCache.set(server.id, { tools, cachedAt: new Date() });
      await query(
        "UPDATE mcp_servers SET status = 'connected', status_checked_at = NOW(), tools_cache = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(tools), server.id]
      );
    } catch (e) {
      toolsCache.set(server.id, { tools: [], cachedAt: new Date(), error: e.message });
      await query(
        "UPDATE mcp_servers SET status = 'unreachable', status_checked_at = NOW(), updated_at = NOW() WHERE id = $1",
        [server.id]
      );
    }
  }));
}

// Role-based tool permissions (Admin vs Member)
export const ADMIN_ONLY_TOOLS = new Set([
  'woocommerce__create_product',
  'woocommerce__update_order_status',
]);

export function isToolAllowedForRole(toolName, role = 'admin') {
  if (role === 'admin') return true;
  return !ADMIN_ONLY_TOOLS.has(toolName);
}

export async function getAllTools(role = 'admin') {
  const result = await query('SELECT * FROM mcp_servers WHERE is_enabled = TRUE');
  const servers = result.rows;
  const allTools = [];

  for (const server of servers) {
    const cached = toolsCache.get(server.id);
    const tools = cached?.tools || server.tools_cache || [];
    for (const tool of tools) {
      const fullName = prefixToolName(server.slug, tool.name);
      // Filter out restricted tools for non-admin roles
      if (!isToolAllowedForRole(fullName, role)) continue;

      allTools.push({
        name: fullName,
        description: `[${server.name}] ${tool.description || ''}`,
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        _serverId: server.id,
        _serverSlug: server.slug,
        _originalName: tool.name,
      });
    }
  }

  return allTools;
}

export async function routeToolCall(prefixedToolName, args, role = 'admin') {
  const { serverSlug, toolName } = parseToolName(prefixedToolName);
  if (!serverSlug) throw new Error(`Tool name must be prefixed with server slug: ${prefixedToolName}`);

  // Enforce tool permissions at execution time
  if (!isToolAllowedForRole(prefixedToolName, role)) {
    throw new Error(`Permission denied: role '${role}' is not authorized to invoke '${prefixedToolName}'. Admin privileges required.`);
  }

  const result = await query(
    'SELECT * FROM mcp_servers WHERE slug = $1 AND is_enabled = TRUE',
    [serverSlug]
  );
  if (!result.rows.length) throw new Error(`Server '${serverSlug}' not found or disabled`);

  const server = result.rows[0];
  return await callToolOnServer(server, toolName, args);
}

export function startCacheRefresh(intervalMs = 60000) {
  refreshAllToolCaches().catch(console.error);
  cacheRefreshInterval = setInterval(() => {
    refreshAllToolCaches().catch(console.error);
  }, intervalMs);
}

export function stopCacheRefresh() {
  if (cacheRefreshInterval) clearInterval(cacheRefreshInterval);
}
