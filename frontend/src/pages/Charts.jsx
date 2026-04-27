import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  format, parseISO, startOfWeek, eachWeekOfInterval,
  subWeeks, subMonths, subDays, isAfter,
} from 'date-fns'
import api from '../api/axios'
import Heatmap from '../components/Heatmap'

const STATUS_COLORS = {
  applied: '#3b82f6',
  interviewing: '#f59e0b',
  offer: '#22c55e',
  rejected: '#ef4444',
}

const TIME_FRAMES = [
  { label: '7 days',   value: 7,   unit: 'days' },
  { label: '30 days',  value: 30,  unit: 'days' },
  { label: '90 days',  value: 90,  unit: 'days' },
  { label: '6 months', value: 6,   unit: 'months' },
  { label: '1 year',   value: 12,  unit: 'months' },
  { label: 'All time', value: null, unit: null },
]

export default function Charts() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [timeFrame, setTimeFrame] = useState(TIME_FRAMES[4]) // default: 1 year

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

  const now = new Date()

  const cutoff = timeFrame.value === null ? null
    : timeFrame.unit === 'days'   ? subDays(now, timeFrame.value)
    : subMonths(now, timeFrame.value)

  const filteredJobs = cutoff
    ? jobs.filter((j) => {
        const ref = j.applied_date || j.created_at
        return ref && isAfter(parseISO(ref), cutoff)
      })
    : jobs

  // ── Applications over time (weekly buckets) ───────────────────
  const weekCount = timeFrame.value === null ? 52
    : timeFrame.unit === 'days' ? Math.ceil(timeFrame.value / 7)
    : timeFrame.value * 4
  const weeks = eachWeekOfInterval({ start: subWeeks(now, Math.max(weekCount - 1, 1)), end: now })
  const weeklyData = weeks.map((weekStart) => {
    const label = format(weekStart, 'MMM d')
    const count = filteredJobs.filter((j) => {
      const ref = j.applied_date || j.created_at
      if (!ref) return false
      return startOfWeek(parseISO(ref)).getTime() === weekStart.getTime()
    }).length
    return { week: label, applications: count }
  })

  // ── Status breakdown (pie chart) ─────────────────────────────
  const statusCounts = ['applied', 'interviewing', 'offer', 'rejected'].map((status) => ({
    name: status,
    value: filteredJobs.filter((j) => j.status === status).length,
  }))

  // ── Metrics ──────────────────────────────────────────────────
  const total = filteredJobs.length
  const responded = filteredJobs.filter((j) => ['interviewing', 'offer', 'rejected'].includes(j.status)).length
  const responseRate = total ? Math.round((responded / total) * 100) : 0
  const offerRate = total
    ? Math.round((filteredJobs.filter((j) => j.status === 'offer').length / total) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>

        {/* Time frame selector */}
        <div className="flex gap-1 flex-wrap">
          {TIME_FRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeFrame(tf)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                timeFrame.label === tf.label
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Applications', value: total,           color: 'text-blue-600' },
          { label: 'Responses Received', value: responded,       color: 'text-yellow-600' },
          { label: 'Response Rate',      value: `${responseRate}%`, color: 'text-purple-600' },
          { label: 'Offer Rate',         value: `${offerRate}%`, color: 'text-green-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">
          Applications Over Time
          <span className="text-xs text-gray-400 font-normal ml-2">({timeFrame.label})</span>
        </h3>
        {total === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">No applications in this period.</p>
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

      {/* Heatmap */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">
          Application Activity
          <span className="text-xs text-gray-400 font-normal ml-2">(last 52 weeks)</span>
        </h3>
        {jobs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No applications yet.</p>
        ) : (
          <Heatmap jobs={jobs} />
        )}
      </div>

      {/* Pie chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">
          Status Breakdown
          <span className="text-xs text-gray-400 font-normal ml-2">({timeFrame.label})</span>
        </h3>
        {total === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">No applications in this period.</p>
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
