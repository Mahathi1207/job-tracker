import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { format, parseISO, startOfWeek, eachWeekOfInterval, subWeeks } from 'date-fns'
import api from '../api/axios'

const STATUS_COLORS = {
  applied: '#3b82f6',
  interviewing: '#f59e0b',
  offer: '#22c55e',
  rejected: '#ef4444',
}

export default function Charts() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/jobs').then((r) => setJobs(r.data)).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ── Applications over time (weekly buckets, last 12 weeks) ───
  const now = new Date()
  const weeks = eachWeekOfInterval({ start: subWeeks(now, 11), end: now })
  const weeklyData = weeks.map((weekStart) => {
    const label = format(weekStart, 'MMM d')
    const count = jobs.filter((j) => {
      if (!j.applied_date) return false
      const d = parseISO(j.applied_date)
      const ws = startOfWeek(d)
      return ws.getTime() === weekStart.getTime()
    }).length
    return { week: label, applications: count }
  })

  // ── Status breakdown (pie chart) ─────────────────────────────
  const statusCounts = ['applied', 'interviewing', 'offer', 'rejected'].map((status) => ({
    name: status,
    value: jobs.filter((j) => j.status === status).length,
  }))

  // ── Metrics ──────────────────────────────────────────────────
  const total = jobs.length
  const responded = jobs.filter((j) => ['interviewing', 'offer', 'rejected'].includes(j.status)).length
  const responseRate = total ? Math.round((responded / total) * 100) : 0
  const offerRate = total
    ? Math.round((jobs.filter((j) => j.status === 'offer').length / total) * 100)
    : 0

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Applications', value: total, color: 'text-blue-600' },
          { label: 'Responses Received', value: responded, color: 'text-yellow-600' },
          { label: 'Response Rate', value: `${responseRate}%`, color: 'text-purple-600' },
          { label: 'Offer Rate', value: `${offerRate}%`, color: 'text-green-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">Applications Over Time (weekly)</h3>
        {total === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">No applications yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="applications"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Pie chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">Status Breakdown</h3>
        {total === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">No applications yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={statusCounts.filter((s) => s.value > 0)}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={true}
              >
                {statusCounts.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => [`${v} applications`]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
