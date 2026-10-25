/**
 * Gateway MCP Server
 * Acts as an MCP server to external clients.
 * Dynamically aggregates tools from all enabled upstream servers.
 * Prefixes tool names with server slug to handle namespace collisions.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getAllTools, routeToolCall, parseToolName } from './client.js';
import { query } from '../db/pool.js';

async function logToolCall({ userId, apiKeyId, serverSlug, toolName, args, durationMs, success, error }) {
  try {
    const sResult = await query('SELECT id FROM mcp_servers WHERE slug = $1', [serverSlug]);
    const serverId = sResult.rows[0]?.id || null;
    await query(
      `INSERT INTO audit_logs (user_id, api_key_id, server_id, server_slug, tool_name, tool_arguments, duration_ms, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, apiKeyId, serverId, serverSlug, toolName, JSON.stringify(args || {}), durationMs, success, error || null]
    );
  } catch (e) {
    console.error('Failed to write audit log:', e.message);
  }
}

export async function handleMcpRequest(req, res, user, apiKeyId) {
  const server = new Server(
    { name: 'urumi-gateway', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Return only tools allowed for the authenticated user's role
    const tools = await getAllTools(user?.role || 'member');
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const { serverSlug, toolName } = parseToolName(name);
    const start = Date.now();
    try {
      // Authorize and route tool call with role enforcement
      const result = await routeToolCall(name, args, user?.role || 'member');
      const durationMs = Date.now() - start;
      await logToolCall({ userId: user.id, apiKeyId, serverSlug, toolName, args, durationMs, success: true });
      return result;
    } catch (e) {
      const durationMs = Date.now() - start;
      await logToolCall({ userId: user.id, apiKeyId, serverSlug, toolName, args, durationMs, success: false, error: e.message });
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: e.message, server: serverSlug, tool: toolName }) }],
        isError: true,
      };
    }
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
