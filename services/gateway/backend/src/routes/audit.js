import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = express.Router();
router.use(authenticate);

// GET /api/audit — paginated audit log (admin: all, member: own)
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50'), 200);
  const offset = parseInt(req.query.offset || '0');

  let sql, params;
  if (req.user.role === 'admin') {
    sql = `SELECT al.*, u.username
           FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
           ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`;
    params = [limit, offset];
  } else {
    sql = `SELECT al.*, u.username
           FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
           WHERE al.user_id = $1
           ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`;
    params = [req.user.id, limit, offset];
  }

  const result = await query(sql, params);
  const countResult = await query(
    req.user.role === 'admin'
      ? 'SELECT COUNT(*) FROM audit_logs'
      : 'SELECT COUNT(*) FROM audit_logs WHERE user_id = $1',
    req.user.role === 'admin' ? [] : [req.user.id]
  );
  res.json({ logs: result.rows, total: parseInt(countResult.rows[0].count) });
});

export default router;
