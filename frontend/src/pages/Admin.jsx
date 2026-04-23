import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'
import api from '../api/axios'

const ADMIN_EMAIL = 'demo@jobtracker.com'

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers]     = useState([])
  const [stats, setStats]     = useState({})
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(null)

  async function handleRevoke(userId, email) {
    if (!window.confirm(`Force logout all sessions for ${email}?`)) return
    setRevoking(userId)
    try {
      await api.post(`/auth/admin/revoke/${userId}`)
      alert(`Sessions revoked for ${email}. They will be logged out on next request.`)
    } catch {
      alert('Failed to revoke sessions.')
    } finally {
      setRevoking(null)
    }
  }

  useEffect(() => {
    if (user?.email !== ADMIN_EMAIL) {
      navigate('/dashboard')
      return
    }
    Promise.all([
      api.get('/auth/admin/users'),
      api.get('/jobs/admin/stats'),
    ]).then(([usersRes, statsRes]) => {
      setUsers(usersRes.data)
      setStats(statsRes.data)
    }).finally(() => setLoading(false))
  }, [user])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const totalJobs        = Object.values(stats).reduce((s, u) => s + u.total, 0)
  const totalInterviewing = Object.values(stats).reduce((s, u) => s + u.interviewing, 0)
  const totalOffers      = Object.values(stats).reduce((s, u) => s + u.offer, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin — Site Overview</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Users',       value: users.length,        color: 'text-blue-600' },
          { label: 'Total Jobs Tracked', value: totalJobs,           color: 'text-indigo-600' },
          { label: 'Interviewing',       value: totalInterviewing,   color: 'text-yellow-600' },
          { label: 'Offers',             value: totalOffers,         color: 'text-green-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Registered Users</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="px-5 py-3 text-left">User</th>
              <th className="px-5 py-3 text-left">Joined</th>
              <th className="px-3 py-3 text-center">Applied</th>
              <th className="px-3 py-3 text-center">Interviewing</th>
              <th className="px-3 py-3 text-center">Offers</th>
              <th className="px-3 py-3 text-center">Rejected</th>
              <th className="px-3 py-3 text-center">Total</th>
              <th className="px-5 py-3 text-left">Last Activity</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((u) => {
              const s = stats[u.id] || { applied: 0, interviewing: 0, offer: 0, rejected: 0, total: 0, last_activity: null }
              const isDemo = u.email === ADMIN_EMAIL
              return (
                <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${isDemo ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-900">{u.full_name || '—'}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                    {isDemo && <span className="text-xs text-blue-500">demo account</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-500">
                    {u.created_at ? formatDistanceToNow(parseISO(u.created_at), { addSuffix: true }) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">{s.applied}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-yellow-100 text-yellow-700 text-xs font-medium px-2 py-0.5 rounded-full">{s.interviewing}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">{s.offer}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">{s.rejected}</span>
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-gray-700">{s.total}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {s.last_activity
                      ? formatDistanceToNow(parseISO(s.last_activity), { addSuffix: true })
                      : 'No activity'}
                  </td>
                  <td className="px-5 py-3">
                    {!isDemo && (
                      <button
                        onClick={() => handleRevoke(u.id, u.email)}
                        disabled={revoking === u.id}
                        className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
                      >
                        {revoking === u.id ? 'Revoking…' : 'Force logout'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
