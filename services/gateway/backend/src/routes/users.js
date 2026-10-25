import express from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = express.Router();
router.use(authenticate, requireAdmin);

// GET /api/users
router.get('/', async (req, res) => {
  const result = await query(
    'SELECT id, username, email, role, created_at FROM users ORDER BY created_at ASC'
  );
  res.json(result.rows);
});

// POST /api/users — create member
router.post('/', async (req, res) => {
  try {
    const { username, email, password, role = 'member' } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'username, email and password required' });
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role, created_at',
      [username, email, hash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// Admin can also revoke any user's API key
router.delete('/:userId/keys/:keyId', async (req, res) => {
  await query(
    'UPDATE api_keys SET is_active = FALSE, revoked_at = NOW() WHERE id = $1 AND user_id = $2',
    [req.params.keyId, req.params.userId]
  );
  res.json({ success: true });
});

// GET /api/users/:userId/keys
router.get('/:userId/keys', async (req, res) => {
  const result = await query(
    'SELECT id, key_prefix, label, is_active, last_used_at, created_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
    [req.params.userId]
  );
  res.json(result.rows);
});

export default router;
