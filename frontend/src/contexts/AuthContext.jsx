import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [loading, setLoading] = useState(true)

  // Fetch user profile whenever the token changes
  useEffect(() => {
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    api
      .get('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => {
        // Token is invalid or expired — clear it
        logout()
      })
      .finally(() => setLoading(false))
  }, [token])

  function saveToken(newToken) {
    localStorage.setItem('token', newToken)
    setToken(newToken)
  }

  async function login(email, password) {
    const params = new URLSearchParams()
    params.append('username', email)
    params.append('password', password)
    const res = await api.post('/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    saveToken(res.data.access_token)
  }

  async function register(email, password, fullName) {
    await api.post('/auth/register', { email, password, full_name: fullName })
    await login(email, password)
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } catch (_) {
      // Ignore errors during logout — we always clear local state
    }
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
