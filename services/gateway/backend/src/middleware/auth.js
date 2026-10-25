/**
 * Authentication middleware
 * Accepts: Bearer <JWT> (dashboard sessions) or x-api-key: <raw key> (MCP clients)
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod';

export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey() {
  const raw = 'urumi_' + crypto.randomBytes(32).toString('hex');
  const prefix = raw.substring(0, 12);
  const hash = hashApiKey(raw);
  return { raw, prefix, hash };
}

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    let apiKey = req.headers['x-api-key'];

    // If no x-api-key header, check Authorization header (e.g. Bearer urumi_... or urumi_...)
    if (!apiKey && authHeader) {
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      if (token.startsWith('urumi_')) {
        apiKey = token;
      }
    }

    if (apiKey) {
      // API key auth
      const keyHash = hashApiKey(apiKey);
      const result = await query(
        `SELECT ak.id as key_id, ak.user_id, ak.is_active, u.role, u.username, u.id as user_id
         FROM api_keys ak JOIN users u ON ak.user_id = u.id
         WHERE ak.key_hash = $1`,
        [keyHash]
      );
      if (!result.rows.length || !result.rows[0].is_active) {
        return res.status(401).json({ error: 'Invalid or revoked API key' });
      }
      const row = result.rows[0];
      // Update last_used_at
      query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.key_id]).catch(() => {});
      req.user = { id: row.user_id, username: row.username, role: row.role };
      req.apiKeyId = row.key_id;
      return next();
    }

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const result = await query('SELECT id, username, role FROM users WHERE id = $1', [payload.sub]);
        if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
        req.user = result.rows[0];
        req.apiKeyId = null;
        return next();
      } catch (jwtErr) {
        // Fallback: in case an API key without 'urumi_' prefix was sent
        const keyHash = hashApiKey(token);
        const result = await query(
          `SELECT ak.id as key_id, ak.user_id, ak.is_active, u.role, u.username, u.id as user_id
           FROM api_keys ak JOIN users u ON ak.user_id = u.id
           WHERE ak.key_hash = $1`,
          [keyHash]
        );
        if (result.rows.length && result.rows[0].is_active) {
          const row = result.rows[0];
          query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.key_id]).catch(() => {});
          req.user = { id: row.user_id, username: row.username, role: row.role };
          req.apiKeyId = row.key_id;
          return next();
        }
        return res.status(401).json({ error: 'Invalid authentication token' });
      }
    }

    return res.status(401).json({ error: 'Authentication required' });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid authentication' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '24h' });
}
