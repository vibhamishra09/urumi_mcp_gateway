import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'urumi',
  user: process.env.DB_USER || 'urumi',
  password: process.env.DB_PASSWORD || 'urumi',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export default pool;
export const query = (text, params) => pool.query(text, params);
