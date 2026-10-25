import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { signToken, authenticate, generateApiKey } from '../middleware/auth.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/keys — generate a new API key
router.post('/keys', authenticate, async (req, res) => {
  try {
    const { label } = req.body;
    const { raw, prefix, hash } = generateApiKey();
    await query(
      'INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES ($1, $2, $3, $4)',
      [req.user.id, hash, prefix, label || 'My API Key']
    );
    // Return raw key ONCE
    res.json({ key: raw, prefix, label });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/keys — list user's keys (or all team keys if admin)
router.get('/keys', authenticate, async (req, res) => {
  let queryText;
  let params;
  if (req.user.role === 'admin') {
    queryText = `SELECT ak.id, ak.key_prefix, ak.label, ak.is_active, ak.last_used_at, ak.created_at, ak.revoked_at, u.username
                 FROM api_keys ak JOIN users u ON ak.user_id = u.id
                 ORDER BY ak.created_at DESC`;
    params = [];
  } else {
    queryText = `SELECT ak.id, ak.key_prefix, ak.label, ak.is_active, ak.last_used_at, ak.created_at, ak.revoked_at
                 FROM api_keys ak
                 WHERE ak.user_id = $1 ORDER BY ak.created_at DESC`;
    params = [req.user.id];
  }
  const result = await query(queryText, params);
  res.json(result.rows);
});

// DELETE /api/auth/keys/:id — revoke key (admins can revoke any key; members can revoke their own)
router.delete('/keys/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await query(
        'UPDATE api_keys SET is_active = FALSE, revoked_at = NOW() WHERE id = $1',
        [req.params.id]
      );
    } else {
      await query(
        'UPDATE api_keys SET is_active = FALSE, revoked_at = NOW() WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
