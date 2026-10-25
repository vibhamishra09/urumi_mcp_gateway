import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'urumi',
  user: process.env.DB_USER || 'urumi',
  password: process.env.DB_PASSWORD || 'urumi',
});

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix VARCHAR(12) NOT NULL,
    label VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  )`,

  `CREATE TABLE IF NOT EXISTS mcp_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    url TEXT NOT NULL,
    auth_type VARCHAR(20) DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header')),
    auth_header_name VARCHAR(100),
    auth_credential_encrypted TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    status VARCHAR(20) DEFAULT 'unknown' CHECK (status IN ('connected', 'unreachable', 'disabled', 'unknown')),
    status_checked_at TIMESTAMPTZ,
    tools_cache JSONB DEFAULT '[]',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    api_key_id UUID REFERENCES api_keys(id),
    server_id UUID REFERENCES mcp_servers(id),
    server_slug VARCHAR(100),
    tool_name VARCHAR(200),
    tool_arguments JSONB,
    duration_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const sql of migrations) {
      await client.query(sql);
    }
    console.log('✅ Database migrations complete');

    // Seed default admin if not exists
    const adminCheck = await client.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.default.hash(process.env.ADMIN_PASSWORD || 'changeme123', 12);
      await client.query(
        "INSERT INTO users (username, email, password_hash, role) VALUES ('admin', 'admin@urumi.local', $1, 'admin')",
        [hash]
      );
      console.log('✅ Default admin user created (admin / changeme123)');
    }

    // Seed default MCP servers
    const defaultServers = [
      { slug: 'woocommerce', name: 'WooCommerce Store', url: 'http://woocommerce-mcp:3000' },
      { slug: 'weather', name: 'Weather Service', url: 'http://weather-mcp:3001' },
      { slug: 'calculator', name: 'Calculator Service', url: 'http://calculator-mcp:3002' },
    ];
    for (const s of defaultServers) {
      const sCheck = await client.query("SELECT id FROM mcp_servers WHERE slug = $1", [s.slug]);
      if (sCheck.rows.length === 0) {
        await client.query(
          "INSERT INTO mcp_servers (slug, name, url, is_enabled, status) VALUES ($1, $2, $3, TRUE, 'unknown')",
          [s.slug, s.name, s.url]
        );
        console.log(`✅ Default server seeded: ${s.name} (${s.slug})`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
