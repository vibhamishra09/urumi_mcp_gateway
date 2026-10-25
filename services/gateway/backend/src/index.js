/**
 * Urumi Gateway Backend
 * - REST API for dashboard
 * - MCP endpoint for external clients (authenticated via API key)
 * - Aggregates tools from upstream MCP servers
 */
import express from 'express';
import cors from 'cors';
import { authenticate } from './middleware/auth.js';
import { startCacheRefresh } from './mcp/client.js';
import { handleMcpRequest } from './mcp/gateway-server.js';
import authRoutes from './routes/auth.js';
import serversRoutes from './routes/servers.js';
import usersRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import chatRoutes from './routes/chat.js';

const PORT = parseInt(process.env.PORT || '4000');
const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health check (unauthenticated)
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'urumi-gateway' }));

// REST API routes
app.use('/api/auth', authRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/chat', chatRoutes);

// MCP Gateway endpoint — requires API key or JWT
app.post('/mcp', authenticate, async (req, res) => {
  await handleMcpRequest(req, res, req.user, req.apiKeyId);
});

app.get('/mcp', (_req, res) => {
  res.status(200).json({ 
    name: 'urumi-gateway',
    description: 'Urumi Team MCP Gateway. POST to /mcp with x-api-key header.',
    version: '1.0.0',
  });
});

// Start background tool cache refresh
startCacheRefresh(60000); // refresh every 60 seconds

app.listen(PORT, () => {
  console.log(`✅ Urumi Gateway listening on :${PORT}`);
  console.log(`   MCP endpoint: POST /mcp (x-api-key or Bearer token required)`);
  console.log(`   REST API:     /api/*`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  process.exit(0);
});
