import { Hono } from 'hono'
import { getTablePrefix } from '../types'
import type { Env } from '../types'

type HonoEnv = { Bindings: Env }

export const setupRoutes = new Hono<HonoEnv>()

const DEFAULT_SETTINGS: Record<string, string> = {
  email_verification_enabled: '0',
  require_2fa: '0',
  registration_enabled: '1',
  smtp_config: '{}',
  resend_config: '{}',
  email_provider: 'none',
  app_name: 'AppTemplate',
}

setupRoutes.get('/:secret', async (c) => {
  const secret = c.req.param('secret')

  if (!c.env.SETUP_SECRET || secret !== c.env.SETUP_SECRET) {
    return c.json({ error: 'Invalid setup secret' }, 403)
  }

  return runSetup(c)
})

setupRoutes.post('/', async (c) => {
  const secret = c.req.header('X-Setup-Secret')

  if (!c.env.SETUP_SECRET || secret !== c.env.SETUP_SECRET) {
    return c.json({ error: 'Invalid setup secret' }, 403)
  }

  return runSetup(c)
})

async function runMigrations(_db: D1Database, _prefix: string): Promise<void> {
  // Add future migrations here
}

async function runSetup(c: any) {
  const prefix = getTablePrefix(c.env)
  const db = c.env.DB

  // Check if already initialized
  const existing = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .bind(`${prefix}users`)
    .first()

  if (existing) {
    await runMigrations(db, prefix)
    return c.json({ success: true, alreadyInitialized: true })
  }

  const schemaSQL = getSchema()
  const resolvedSQL = schemaSQL.replace(/\{prefix\}/g, prefix)

  const statements = resolvedSQL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    await db.prepare(stmt).run()
  }

  const now = new Date().toISOString()
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${prefix}system_settings (key, value, updated_at) VALUES (?, ?, ?)`
      )
      .bind(key, value, now)
      .run()
  }

  return c.json({ success: true })
}

function getSchema(): string {
  return `CREATE TABLE IF NOT EXISTS {prefix}users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  is_active     INTEGER NOT NULL DEFAULT 1,
  email_verified INTEGER NOT NULL DEFAULT 0,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  language      TEXT NOT NULL DEFAULT 'zh',
  theme         TEXT NOT NULL DEFAULT 'system',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}user_2fa (
  user_id           TEXT PRIMARY KEY REFERENCES {prefix}users(id) ON DELETE CASCADE,
  totp_secret       TEXT,
  totp_enabled      INTEGER NOT NULL DEFAULT 0,
  passkey_credentials TEXT,
  passkey_enabled   INTEGER NOT NULL DEFAULT 0,
  email_otp_enabled INTEGER NOT NULL DEFAULT 0,
  preferred_method  TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`
}
