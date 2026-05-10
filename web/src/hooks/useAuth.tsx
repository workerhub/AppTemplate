import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { User } from '@/types'
import i18n from '@/lib/i18n'

interface LoginResponse {
  success?: boolean
  user?: User
  requires2fa?: boolean
  tempToken?: string
  availableMethods?: string[]
  needs2faSetup?: boolean
}

interface RegisterResponse {
  success?: boolean
  requiresVerification?: boolean
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<LoginResponse>
  register: (email: string, password: string) => Promise<RegisterResponse>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<User>('/me', { skipRedirect: true })
      setUser(data)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  // Sync language and theme from user profile (source of truth)
  useEffect(() => {
    if (!user) return
    if (user.language && i18n.language !== user.language) {
      i18n.changeLanguage(user.language)
    }
    if (user.theme) {
      const stored = localStorage.getItem('theme')
      if (stored !== user.theme) {
        localStorage.setItem('theme', user.theme)
        // Apply theme immediately
        const root = document.documentElement
        if (user.theme === 'system') {
          const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          root.classList.toggle('dark', isDark)
        } else {
          root.classList.toggle('dark', user.theme === 'dark')
        }
      }
    }
  }, [user])

  const login = async (email: string, password: string): Promise<LoginResponse> => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password })
    if (res.success && !res.requires2fa) {
      await refreshUser()
    } else if (res.success && res.user) {
      setUser(res.user as User)
    }
    return res
  }

  const register = async (email: string, password: string): Promise<RegisterResponse> => {
    return await api.post<RegisterResponse>('/auth/register', { email, password })
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // clear local state even if API fails
    }
    sessionStorage.removeItem('impersonate_user_id')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
