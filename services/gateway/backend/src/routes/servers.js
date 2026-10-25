import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { refreshAllToolCaches, fetchToolsFromServer } from '../mcp/client.js';

const router = express.Router();
router.use(authenticate);

// GET /api/servers
router.get('/', async (req, res) => {
  const result = await query(
    `SELECT id, slug, name, url, auth_type, auth_header_name, is_enabled, status, status_checked_at, tools_cache, created_at
     FROM mcp_servers ORDER BY created_at ASC`
  );
  res.json(result.rows);
});

// SSRF protection: reject invalid protocols and cloud metadata endpoints
function validateServerUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (err) {
    throw new Error('Invalid server URL format');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https protocols are supported');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data' ||
    hostname === 'fd00:ec2::254'
  ) {
    throw new Error('Access to cloud metadata endpoints is prohibited (SSRF protection)');
  }
}

// POST /api/servers — admin only
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { slug, name, url, auth_type = 'none', auth_header_name, credential } = req.body;
    if (!slug || !name || !url) return res.status(400).json({ error: 'slug, name and url are required' });

    validateServerUrl(url);

    const result = await query(
      `INSERT INTO mcp_servers (slug, name, url, auth_type, auth_header_name, auth_credential_encrypted, is_enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7) RETURNING id, slug, name, url, auth_type, is_enabled, status`,
      [slug, name, url, auth_type, auth_header_name || null, credential || null, req.user.id]
    );
    // Trigger tool refresh for this server
    refreshAllToolCaches().catch(console.error);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Server slug already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/servers/:id — admin only
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, url, auth_type, auth_header_name, credential, is_enabled } = req.body;
    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); vals.push(name); }
    if (url !== undefined) {
      validateServerUrl(url);
      fields.push(`url = $${idx++}`);
      vals.push(url);
    }
    if (auth_type !== undefined) { fields.push(`auth_type = $${idx++}`); vals.push(auth_type); }
    if (auth_header_name !== undefined) { fields.push(`auth_header_name = $${idx++}`); vals.push(auth_header_name); }
    if (credential !== undefined) { fields.push(`auth_credential_encrypted = $${idx++}`); vals.push(credential); }
    if (is_enabled !== undefined) {
      fields.push(`is_enabled = $${idx++}`); vals.push(is_enabled);
      fields.push(`status = $${idx++}`); vals.push(is_enabled ? 'unknown' : 'disabled');
    }
    fields.push(`updated_at = NOW()`);
    vals.push(req.params.id);

    await query(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = $${idx}`, vals);
    refreshAllToolCaches().catch(console.error);
    const result = await query('SELECT id, slug, name, url, auth_type, is_enabled, status FROM mcp_servers WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/servers/:id — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM mcp_servers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// POST /api/servers/:id/refresh — force tool cache refresh
router.post('/:id/refresh', requireAdmin, async (req, res) => {
  const result = await query('SELECT * FROM mcp_servers WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Server not found' });
  try {
    const tools = await fetchToolsFromServer(result.rows[0]);
    await query(
      "UPDATE mcp_servers SET status = 'connected', status_checked_at = NOW(), tools_cache = $1 WHERE id = $2",
      [JSON.stringify(tools), req.params.id]
    );
    res.json({ tools });
  } catch (e) {
    await query("UPDATE mcp_servers SET status = 'unreachable', status_checked_at = NOW() WHERE id = $1", [req.params.id]);
    res.status(502).json({ error: e.message });
  }
});

export default router;
