export interface Env {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  SETUP_SECRET: string
  TABLE_PREFIX: string
  ASSETS: Fetcher
}

export interface User {
  id: string
  email: string
  password_hash: string
  role: 'admin' | 'user'
  is_active: number
  email_verified: number
  timezone: string
  language: string
  theme: 'light' | 'dark' | 'system'
  created_at: string
  updated_at: string
}

export interface User2FA {
  user_id: string
  totp_secret: string | null
  totp_enabled: number
  passkey_credentials: string | null
  passkey_enabled: number
  email_otp_enabled: number
  preferred_method: 'totp' | 'passkey' | 'email_otp' | null
  updated_at: string
}

export interface SystemSetting {
  key: string
  value: string
  updated_at: string
}

export interface JWTPayload {
  sub: string
  role: string
  jti: string
  exp: number
  iat: number
  needs_2fa_setup?: boolean
}

export type HonoEnv = { Bindings: Env; Variables: { userId: string; role: string; impersonating?: string } }

export function getTablePrefix(env: Env): string {
  const raw = env.TABLE_PREFIX || ''
  if (!raw) return ''
  return raw.endsWith('_') ? raw : raw + '_'
}
