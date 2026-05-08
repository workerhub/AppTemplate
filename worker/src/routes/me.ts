import { Hono } from 'hono'
import { getTablePrefix } from '../types'
import type { HonoEnv, JWTPayload } from '../types'
import { authMiddleware, getEffectiveUserId } from '../middleware/auth'
import { rateLimit } from '../middleware/ratelimit'
import { findUserById, updateUser } from '../db/queries/users'
import { get2FAConfig } from '../db/queries/twofa'
import { hashPassword, verifyPassword, generateJti, signJWT, verifyJWT } from '../core/auth'
import { getSessionIndex, removeSessionIndex, addSessionIndex } from './auth'
import { getCookie, setCookie } from 'hono/cookie'

export const meRoutes = new Hono<HonoEnv>()

meRoutes.use('*', authMiddleware)
meRoutes.use('/password', rateLimit({ max: 5, window: 300, keyPrefix: 'pwd_change' }))

meRoutes.get('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const twoFA = await get2FAConfig(c.env.DB, prefix, userId)

  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    email_verified: !!user.email_verified,
    timezone: user.timezone,
    language: user.language,
    theme: user.theme,
    created_at: user.created_at,
    twofa: {
      totp_enabled: !!twoFA?.totp_enabled,
      passkey_enabled: !!twoFA?.passkey_enabled,
      email_otp_enabled: !!twoFA?.email_otp_enabled,
      preferred_method: twoFA?.preferred_method || null,
    },
  })
})

meRoutes.put('/', async (c) => {
  const userId = getEffectiveUserId(c)
  const prefix = getTablePrefix(c.env)
  const body = await c.req.json<{ timezone?: string; language?: string; theme?: string }>()

  const updates: Record<string, any> = {}
  if (body.timezone) updates.timezone = body.timezone
  if (body.language) updates.language = body.language
  if (body.theme && ['light', 'dark', 'system'].includes(body.theme)) updates.theme = body.theme

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  await updateUser(c.env.DB, prefix, userId, updates)
  return c.json({ success: true })
})

meRoutes.put('/password', async (c) => {
  const userId = c.get('userId') // Can't change password via impersonation
  const prefix = getTablePrefix(c.env)
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword: string; newPassword: string }>()

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Current and new password required' }, 400)
  }

  if (newPassword.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const user = await findUserById(c.env.DB, prefix, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401)

  const hash = await hashPassword(newPassword)
  await updateUser(c.env.DB, prefix, userId, { password_hash: hash })

  // Invalidate current access token
  const accessTokenStr = getCookie(c, 'access_token')
  if (accessTokenStr) {
    const payload = await verifyJWT(accessTokenStr, c.env.JWT_SECRET)
    if (payload) {
      const remaining = payload.exp - Math.floor(Date.now() / 1000)
      if (remaining > 0) {
        await c.env.KV.put(`bl:${payload.jti}`, '1', { expirationTtl: Math.max(remaining, 60) })
      }
    }
  }

  // Invalidate current refresh token
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const rtPayload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (rtPayload) {
      await c.env.KV.delete(`rt:${rtPayload.jti}`)
      await removeSessionIndex(c.env.KV, userId, rtPayload.jti)
    }
  }

  // Issue new tokens
  const now = Math.floor(Date.now() / 1000)
  const newAccessJti = generateJti()
  const newRefreshJti = generateJti()

  const accessPayload: JWTPayload = { sub: userId, role: user.role, jti: newAccessJti, iat: now, exp: now + 86400 }
  const refreshPayload: JWTPayload = { sub: userId, role: user.role, jti: newRefreshJti, iat: now, exp: now + 604800 }

  const newAccessToken = await signJWT(accessPayload, c.env.JWT_SECRET)
  const newRefreshToken = await signJWT(refreshPayload, c.env.JWT_SECRET)

  await c.env.KV.put(`rt:${newRefreshJti}`, userId, { expirationTtl: 604800 })
  // Track new session in KV index
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ua = c.req.header('user-agent') || 'unknown'
  await addSessionIndex(c.env.KV, userId, { jti: newRefreshJti, iat: now, exp: now + 604800, ip, ua })

  setCookie(c, 'access_token', newAccessToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 86400 })
  setCookie(c, 'refresh_token', newRefreshToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 604800 })

  return c.json({ success: true })
})

// ── Sessions ──────────────────────────────────────────────────────────────

meRoutes.get('/sessions', async (c) => {
  const userId = c.get('userId') // Use real user, not impersonated
  const sessions = await getSessionIndex(c.env.KV, userId)

  // Identify current session from refresh token
  let currentJti: string | undefined
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const payload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (payload) currentJti = payload.jti
  }

  // Verify each session's refresh token still exists in KV (may have been revoked)
  const validSessions = []
  for (const s of sessions) {
    const exists = await c.env.KV.get(`rt:${s.jti}`)
    if (exists) {
      validSessions.push({
        jti: s.jti,
        iat: s.iat,
        exp: s.exp,
        ip: s.ip,
        ua: s.ua,
        current: s.jti === currentJti,
      })
    }
  }

  // Clean up stale entries from the index
  const validJtis = new Set(validSessions.map(s => s.jti))
  const staleJtis = sessions.filter(s => !validJtis.has(s.jti))
  if (staleJtis.length > 0) {
    const key = `sessions:${userId}`
    const remaining = sessions.filter(s => validJtis.has(s.jti))
    if (remaining.length === 0) {
      await c.env.KV.delete(key)
    } else {
      await c.env.KV.put(key, JSON.stringify(remaining), { expirationTtl: 604800 })
    }
  }

  return c.json(validSessions)
})

meRoutes.delete('/sessions/:jti', async (c) => {
  const userId = c.get('userId')
  const jti = c.req.param('jti')

  // Don't allow revoking current session via this endpoint (use logout instead)
  const refreshTokenStr = getCookie(c, 'refresh_token')
  if (refreshTokenStr) {
    const payload = await verifyJWT(refreshTokenStr, c.env.JWT_SECRET)
    if (payload && payload.jti === jti) {
      return c.json({ error: 'Use logout to end current session' }, 400)
    }
  }

  // Verify the session belongs to this user
  const sessions = await getSessionIndex(c.env.KV, userId)
  const target = sessions.find(s => s.jti === jti)
  if (!target) return c.json({ error: 'Session not found' }, 404)

  // Revoke: delete refresh token from KV
  await c.env.KV.delete(`rt:${jti}`)

  // Blacklist the access token associated with this session
  const now = Math.floor(Date.now() / 1000)
  const remaining = target.exp - now
  if (remaining > 0) {
    await c.env.KV.put(`bl:${jti}`, '1', { expirationTtl: Math.min(remaining, 86400) })
  }

  // Remove from session index
  await removeSessionIndex(c.env.KV, userId, jti)

  return c.json({ success: true })
})
