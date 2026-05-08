export interface User {
  id: string
  email: string
  role: 'admin' | 'user'
  email_verified: boolean
  is_active: boolean
  timezone: string
  language: string
  theme: 'light' | 'dark' | 'system'
  created_at: string
  twofa?: {
    totp_enabled: boolean
    passkey_enabled: boolean
    email_otp_enabled: boolean
    preferred_method: string | null
  }
}

export interface SystemSettings {
  email_verification_enabled: string
  require_2fa: string
  registration_enabled: string
  smtp_config: string
  resend_config: string
  email_provider: string
  app_name?: string
}

export interface Session {
  jti: string
  iat: number
  exp: number
  ip?: string
  ua?: string
  current: boolean
}
