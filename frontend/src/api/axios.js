import axios from 'axios'

// In development (npm run dev), Vite proxies /api → localhost:8000 and strips the prefix.
// In production (Docker), nginx proxies /api → api-gateway:8000 and strips the prefix.
// Setting baseURL to /api/ means every call hits the gateway transparently in both environments.
const api = axios.create({
  baseURL: '/api',
})

// Attach the JWT Bearer token on every request if present in localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401 responses, remove the stale token so the user is redirected to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export default api
