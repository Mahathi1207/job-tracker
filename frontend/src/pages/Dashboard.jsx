import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { differenceInDays, parseISO, format, subDays, startOfDay } from 'date-fns'
import { triggerConfetti } from '../utils/confetti'

const MILESTONES = [5, 10, 25, 50, 100]

function checkMilestones(count) {
  const done = JSON.parse(localStorage.getItem('milestones_done') || '[]')
  MILESTONES.forEach((m) => {
    if (count >= m && !done.includes(m)) {
      triggerConfetti(150)
      done.push(m)
      localStorage.setItem('milestones_done', JSON.stringify(done))
      // Show a brief toast
      const toast = document.createElement('div')
      toast.textContent = `🎉 Milestone: ${m} applications!`
      toast.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);
        background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;
        padding:12px 24px;border-radius:999px;font-weight:600;font-size:14px;
        z-index:9999;box-shadow:0 4px 20px rgba(124,58,237,0.4);
        animation:countPop 0.4s ease-out;`
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 3000)
    }
  })
}

function calcStreak(jobs) {
  const today = startOfDay(new Date())
  const dates = new Set(jobs.map((j) => j.applied_date).filter(Boolean))
  let streak = 0
  let cur = today
  if (!dates.has(format(today, 'yyyy-MM-dd'))) cur = subDays(today, 1)
  if (!dates.has(format(cur, 'yyyy-MM-dd'))) return 0
  while (dates.has(format(cur, 'yyyy-MM-dd'))) {
    streak++
    cur = subDays(cur, 1)
  }
  return streak
}

function GoalRing({ applied, goal, onEdit }) {
  const pct = goal > 0 ? Math.min(applied / goal, 1) : 0
  const r = 36
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  const isDark = document.documentElement.classList.contains('dark')
  const ringColor = isDark ? '#00ff88' : '#7c3aed'
  const trackColor = isDark ? '#1f2937' : '#ede9fe'
  const textColor = isDark ? '#e2e8f0' : '#1f2937'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center gap-4">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke={trackColor} strokeWidth="7" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={ringColor} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: 'stroke-dasharray 0.7s ease' }}
        />
        <text x="44" y="40" textAnchor="middle" fontSize="18" fontWeight="700" fill={textColor}>{applied}</text>
        <text x="44" y="56" textAnchor="middle" fontSize="11" fill="#9ca3af">/ {goal}</text>
      </svg>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide">This week</p>
        <p className="font-semibold text-gray-800 text-sm mt-0.5">
          {applied >= goal && goal > 0 ? '🎯 Goal reached!' : `${Math.max(0, goal - applied)} more to go`}
        </p>
        <button onClick={onEdit} className="text-xs text-blue-600 hover:underline mt-1">
          Edit goal ({goal}/week)
        </button>
      </div>
    </div>
  )
}
import api from '../api/axios'
import KanbanBoard from '../components/KanbanBoard'
import ResumeAnalyzer from '../components/ResumeAnalyzer'
import ResumeBoard from '../components/ResumeBoard'
import CsvImport from '../components/CsvImport'

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected']

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const start = prev.current
    const end = typeof value === 'number' ? value : 0
    if (start === end) return
    const duration = 600
    const startTime = performance.now()
    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + (end - start) * eased))
      if (progress < 1) requestAnimationFrame(tick)
      else { setDisplay(end); prev.current = end }
    }
    requestAnimationFrame(tick)
  }, [value])
  return <span className="count-pop">{display}</span>
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [resumes, setResumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [showAddResume, setShowAddResume] = useState(false)
  const [form, setForm] = useState({
    company: '', role: '', status: 'applied',
    salary_min: '', salary_max: '', applied_date: new Date().toISOString().split('T')[0],
    deadline: '', location: '', job_description: '',
  })
  const [filters, setFilters] = useState({ location: '', salary: 0, days: 0 })
  const [resumeForm, setResumeForm] = useState({ name: '', keywords: '' })
  const [resumePdf, setResumePdf]   = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [addingResume, setAddingResume] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [weeklyGoal, setWeeklyGoal] = useState(() => Number(localStorage.getItem('weekly_goal') || 5))
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')

  useEffect(() => {
    Promise.all([fetchJobs(), fetchResumes()]).finally(() => setLoading(false))
    const handler = (e) => {
      setJobs((prev) => {
        const updated = [e.detail, ...prev]
        checkMilestones(updated.length)
        return updated
      })
    }
    window.addEventListener('job-quick-added', handler)
    return () => window.removeEventListener('job-quick-added', handler)
  }, [])

  async function fetchJobs() {
    try {
      const res = await api.get('/jobs')
      setJobs(res.data)
      checkMilestones(res.data.length)
    } catch (err) {
      console.error('Failed to fetch jobs', err)
    }
  }

  async function fetchResumes() {
    try {
      const res = await api.get('/resumes')
      setResumes(res.data)
    } catch (err) {
      console.error('Failed to fetch resumes', err)
    }
  }

  function handleJobUpdated(updatedJob) {
    setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)))
  }

  function handleJobAdded(newJob) {
    setJobs((prev) => [newJob, ...prev])
  }

  function handleResumeDeleted(resumeId) {
    setResumes((prev) => prev.filter((r) => r.id !== resumeId))
    if (activeTab === resumeId) setActiveTab('all')
    setJobs((prev) => prev.map((j) => j.resume_id === resumeId ? { ...j, resume_id: null } : j))
  }

  async function handleAddJob(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const payload = {
        ...form,
        salary_min: form.salary_min ? Number(form.salary_min) : null,
        salary_max: form.salary_max ? Number(form.salary_max) : null,
        applied_date: form.applied_date || null,
        deadline: form.deadline || null,
        location: form.location || null,
        job_description: form.job_description || null,
      }
      const res = await api.post('/jobs', payload)
      setJobs((prev) => [res.data, ...prev])
      setShowForm(false)
      setForm({ company: '', role: '', status: 'applied', salary_min: '', salary_max: '', applied_date: new Date().toISOString().split('T')[0], deadline: '', location: '', job_description: '' })
    } catch (err) {
      console.error('Failed to add job', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAddResume(e) {
    e.preventDefault()
    setAddingResume(true)
    try {
      const res = await api.post('/resumes', {
        name: resumeForm.name,
        keywords: resumeForm.keywords || null,
      })
      const newResume = res.data

      // Extract and store resume text if PDF was uploaded
      if (resumePdf) {
        setExtracting(true)
        try {
          const form = new FormData()
          form.append('file', resumePdf)
          const textRes = await api.post('/ai/extract-resume-text', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          localStorage.setItem(`board_resume_${newResume.id}`, textRes.data.text)
        } catch (err) {
          console.error('PDF extraction failed', err)
        } finally {
          setExtracting(false)
        }
      }

      setResumes((prev) => [...prev, newResume])
      setActiveTab(newResume.id)
      setShowAddResume(false)
      setResumeForm({ name: '', keywords: '' })
      setResumePdf(null)
    } catch (err) {
      console.error('Failed to add resume', err)
    } finally {
      setAddingResume(false)
    }
  }

  function exportCSV() {
    const headers = ['Company', 'Role', 'Status', 'Applied Date', 'Deadline', 'Salary Min', 'Salary Max', 'Interview Date', 'Notes']
    const rows = jobs.map((j) => [
      `"${(j.company || '').replace(/"/g, '""')}"`,
      `"${(j.role || '').replace(/"/g, '""')}"`,
      j.status,
      j.applied_date || '',
      j.deadline || '',
      j.salary_min || '',
      j.salary_max || '',
      j.interview_at ? format(parseISO(j.interview_at), 'yyyy-MM-dd HH:mm') : '',
      `"${(j.notes || '').replace(/"/g, '""')}"`,
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalApplied = jobs.length
  const totalInterviewing = jobs.filter((j) => j.status === 'interviewing').length
  const totalOffers = jobs.filter((j) => j.status === 'offer').length
  const responseRate = totalApplied
    ? Math.round(((totalInterviewing + totalOffers) / totalApplied) * 100)
    : 0

  const followUpJobs = jobs.filter((j) => {
    if (j.status === 'offer' || j.status === 'rejected') return false
    if (!j.applied_date) return false
    const appliedDays = differenceInDays(new Date(), parseISO(j.applied_date))
    const threshold = j.status === 'applied' ? 14 : 7
    if (appliedDays < threshold) return false
    // warning clears if user has updated the record recently
    if (j.updated_at && differenceInDays(new Date(), parseISO(j.updated_at)) < threshold) return false
    return true
  })

  const streak = calcStreak(jobs)

  const thisWeekStart = subDays(startOfDay(new Date()), new Date().getDay() === 0 ? 6 : new Date().getDay() - 1)
  const thisWeekApplied = jobs.filter((j) => {
    if (!j.applied_date) return false
    return parseISO(j.applied_date) >= thisWeekStart
  }).length

  const maxSalary = Math.max(0, ...jobs.map((j) => j.salary_max || j.salary_min || 0))
  const salarySliderMax = Math.ceil((maxSalary || 200000) / 10000) * 10000

  const filteredJobs = jobs.filter((j) => {
    if (filters.location && !(j.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false
    if (filters.salary > 0 && !((j.salary_max || j.salary_min || 0) >= filters.salary)) return false
    if (filters.days > 0) {
      const ref = j.applied_date || j.updated_at
      if (!ref || differenceInDays(new Date(), parseISO(ref)) > filters.days) return false
    }
    return true
  })

  const upcomingInterviews = jobs
    .filter((j) => j.interview_at && new Date(j.interview_at) > new Date())
    .sort((a, b) => new Date(a.interview_at) - new Date(b.interview_at))
    .slice(0, 5)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const activeResume = resumes.find((r) => r.id === activeTab) ?? null

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Applied', value: totalApplied, color: 'text-blue-600', isNum: true },
          { label: 'Interviewing', value: totalInterviewing, color: 'text-yellow-600', isNum: true },
          { label: 'Offers', value: totalOffers, color: 'text-green-600', isNum: true },
          { label: 'Response Rate', value: responseRate, color: 'text-purple-600', isNum: false },
        ].map(({ label, value, color, isNum }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>
              {isNum ? <AnimatedNumber value={value} /> : <><AnimatedNumber value={value} />%</>}
            </p>
          </div>
        ))}
      </div>

      {/* Streak + goal row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Streak */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center gap-4">
          <div className="text-4xl">{streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '🌱'}</div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Application Streak</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">
              {streak} <span className="text-sm font-normal text-gray-500">{streak === 1 ? 'day' : 'days'}</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {streak === 0 ? 'Apply today to start a streak!' : streak >= 7 ? 'On fire! Keep it up!' : 'Keep the momentum going!'}
            </p>
          </div>
        </div>

        {/* Weekly goal ring */}
        {editingGoal ? (
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center gap-3">
            <input
              type="number"
              min="1"
              max="50"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="e.g. 5"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={() => {
                const g = Math.max(1, Number(goalInput) || weeklyGoal)
                setWeeklyGoal(g)
                localStorage.setItem('weekly_goal', g)
                setEditingGoal(false)
              }}
              className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm"
            >Save</button>
            <button onClick={() => setEditingGoal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        ) : (
          <GoalRing
            applied={thisWeekApplied}
            goal={weeklyGoal}
            onEdit={() => { setGoalInput(String(weeklyGoal)); setEditingGoal(true) }}
          />
        )}
      </div>

      {/* Upcoming interviews */}
      {upcomingInterviews.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-purple-800 mb-3">Upcoming Interviews</h3>
          <div className="flex flex-wrap gap-3">
            {upcomingInterviews.map((j) => (
              <button
                key={j.id}
                onClick={() => navigate(`/jobs/${j.id}`)}
                className="bg-white border border-purple-200 rounded-lg px-3 py-2 text-left hover:shadow-sm transition-shadow"
              >
                <p className="text-sm font-medium text-gray-900">{j.company}</p>
                <p className="text-xs text-purple-600 mt-0.5">
                  {format(parseISO(j.interview_at), 'MMM d, h:mm a')}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up alerts */}
      {followUpJobs.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-orange-800 mb-1">
            Follow-up Needed ({followUpJobs.length})
          </h3>
          <p className="text-xs text-orange-600 mb-3">
            These applications haven't had any activity in a while.
          </p>
          <div className="flex flex-wrap gap-2">
            {followUpJobs.slice(0, 8).map((j) => (
              <button
                key={j.id}
                onClick={() => navigate(`/jobs/${j.id}`)}
                className="text-xs bg-white border border-orange-200 text-orange-700 rounded-full px-3 py-1 hover:bg-orange-100 transition-colors"
              >
                {j.company} · {j.role}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Resume tabs */}
      {resumes.length > 0 && (
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Applications
          </button>
          {resumes.map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveTab(r.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === r.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {r.name}
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">
                {jobs.filter((j) => j.resume_id === r.id).length}
              </span>
            </button>
          ))}
          <button
            onClick={() => setShowAddResume(true)}
            className="px-3 py-2.5 text-sm text-gray-400 hover:text-blue-600 whitespace-nowrap border-b-2 border-transparent transition-colors"
          >
            + Add Resume
          </button>
        </div>
      )}

      {/* Resume board view */}
      {activeResume ? (
        <ResumeBoard
          resume={activeResume}
          jobs={jobs}
          onJobUpdated={handleJobUpdated}
          onJobAdded={handleJobAdded}
          onResumeDeleted={handleResumeDeleted}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              {resumes.length === 0 ? 'Kanban Board' : 'All Applications'}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <ResumeAnalyzer />
              <button
                onClick={() => setShowImport(true)}
                className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                Import CSV
              </button>
              <button
                onClick={exportCSV}
                className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                Export CSV
              </button>
              {resumes.length === 0 && (
                <button
                  onClick={() => setShowAddResume(true)}
                  className="border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
                >
                  + Resume Board
                </button>
              )}
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                + Add Application
              </button>
            </div>
          </div>
          {/* Filter bar */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-4 items-end">
            {/* Location */}
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs font-medium text-gray-500 block mb-1">Location</label>
              <input
                type="text"
                placeholder="e.g. New York, Remote"
                value={filters.location}
                onChange={(e) => setFilters({ ...filters, location: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Salary slider */}
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Min Salary
                {filters.salary > 0
                  ? <span className="ml-1 text-blue-600">${filters.salary.toLocaleString()}+</span>
                  : <span className="ml-1 text-gray-400">Any</span>}
              </label>
              <input
                type="range"
                min={0}
                max={salarySliderMax}
                step={10000}
                value={filters.salary}
                onChange={(e) => setFilters({ ...filters, salary: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Date range */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Applied within</label>
              <div className="flex gap-1">
                {[{ label: 'All', value: 0 }, { label: '7d', value: 7 }, { label: '30d', value: 30 }, { label: '60d', value: 60 }, { label: '90d', value: 90 }].map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => setFilters({ ...filters, days: value })}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                      filters.days === value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear */}
            {(filters.location || filters.salary > 0 || filters.days > 0) && (
              <button
                onClick={() => setFilters({ location: '', salary: 0, days: 0 })}
                className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>

          <KanbanBoard jobs={filteredJobs} onJobUpdated={handleJobUpdated} />
        </>
      )}

      {/* Add Job modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 my-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">New Application</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleAddJob} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Company *</label>
                  <input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Google" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Role *</label>
                  <input required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Senior Software Engineer" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Salary Min</label>
                  <input type="number" value={form.salary_min} onChange={(e) => setForm({ ...form, salary_min: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="90000" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Salary Max</label>
                  <input type="number" value={form.salary_max} onChange={(e) => setForm({ ...form, salary_max: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="130000" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Location</label>
                <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. New York, Remote, Austin TX" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Applied Date</label>
                  <input type="date" value={form.applied_date} onChange={(e) => setForm({ ...form, applied_date: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Deadline</label>
                  <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Job Description (for AI tips)</label>
                <textarea rows={3} value={form.job_description} onChange={(e) => setForm({ ...form, job_description: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Paste the job description here…" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {submitting ? 'Adding…' : 'Add Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CSV modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg">
            <div className="flex justify-end mb-2">
              <button onClick={() => setShowImport(false)} className="text-white text-xl hover:opacity-75">✕</button>
            </div>
            <CsvImport onImported={() => { fetchJobs(); setShowImport(false) }} />
          </div>
        </div>
      )}

      {/* Add Resume modal */}
      {showAddResume && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">New Resume Board</h3>
              <button onClick={() => setShowAddResume(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleAddResume} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600">Board Name *</label>
                <input
                  required
                  value={resumeForm.name}
                  onChange={(e) => setResumeForm({ ...resumeForm, name: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="SDE Resume, Frontend Resume, Teaching Resume…"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Job Search Keywords
                  <span className="text-gray-400 font-normal ml-1">(used to find daily openings)</span>
                </label>
                <input
                  value={resumeForm.keywords}
                  onChange={(e) => setResumeForm({ ...resumeForm, keywords: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. React frontend engineer, Python backend, teacher"
                />
                <p className="text-xs text-gray-400 mt-1">Leave blank to use the board name as search term.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Your Resume PDF
                  <span className="text-gray-400 font-normal ml-1">(used for analyzing job matches)</span>
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setResumePdf(e.target.files[0] || null)}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {resumePdf && <p className="text-xs text-green-600 mt-1">✓ {resumePdf.name}</p>}
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddResume(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" disabled={addingResume}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {addingResume ? 'Creating…' : 'Create Board'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
