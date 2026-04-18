import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import api from '../api/axios'

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected']

const STATUS_BADGE = {
  applied: 'bg-blue-100 text-blue-700',
  interviewing: 'bg-yellow-100 text-yellow-700',
  offer: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const AI_TABS = [
  { key: 'resume', label: 'Resume Tips', endpoint: '/ai/resume-tips' },
  { key: 'interview', label: 'Interview Prep', endpoint: '/ai/interview-prep' },
  { key: 'cover', label: 'Cover Letter', endpoint: '/ai/cover-letter' },
]

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('resume')
  const [aiData, setAiData] = useState({})
  const [aiLoading, setAiLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    fetchJob()
  }, [id])

  async function fetchJob() {
    try {
      const res = await api.get(`/jobs/${id}`)
      setJob(res.data)
      setNotes(res.data.notes || '')
    } catch {
      navigate('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  async function fetchAiTips() {
    if (!job?.job_description) return
    const tab = AI_TABS.find((t) => t.key === activeTab)
    if (!tab || aiData[activeTab]) return // already loaded

    setAiLoading(true)
    try {
      const res = await api.post(tab.endpoint, {
        job_description: job.job_description,
        user_context: `Role: ${job.role} at ${job.company}`,
      })
      setAiData((prev) => ({ ...prev, [activeTab]: res.data }))
    } catch (err) {
      console.error('AI call failed', err)
    } finally {
      setAiLoading(false)
    }
  }

  // Fetch AI tips whenever the tab changes
  useEffect(() => {
    if (job) fetchAiTips()
  }, [activeTab, job])

  async function handleStatusChange(newStatus) {
    try {
      const res = await api.patch(`/jobs/${id}/status`, { status: newStatus })
      setJob(res.data)
    } catch (err) {
      console.error('Status update failed', err)
    }
  }

  async function handleSaveNotes() {
    setSavingNotes(true)
    try {
      const res = await api.patch(`/jobs/${id}`, { notes })
      setJob(res.data)
    } catch (err) {
      console.error('Notes save failed', err)
    } finally {
      setSavingNotes(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this application?')) return
    await api.delete(`/jobs/${id}`)
    navigate('/dashboard')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!job) return null

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate('/dashboard')}
        className="text-sm text-blue-600 hover:underline mb-4 flex items-center gap-1"
      >
        ← Back to Dashboard
      </button>

      <div className="flex gap-6">
        {/* ── Left panel: job details ─────────────── */}
        <div className="flex-1 space-y-5">
          {/* Header card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{job.company}</h1>
                <p className="text-gray-500 text-lg mt-0.5">{job.role}</p>
              </div>
              <span className={`text-sm font-medium px-3 py-1 rounded-full ${STATUS_BADGE[job.status]}`}>
                {job.status}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {job.applied_date && (
                <div>
                  <span className="text-gray-400">Applied</span>
                  <p className="font-medium">{format(parseISO(job.applied_date), 'MMM d, yyyy')}</p>
                </div>
              )}
              {job.deadline && (
                <div>
                  <span className="text-gray-400">Deadline</span>
                  <p className="font-medium">{format(parseISO(job.deadline), 'MMM d, yyyy')}</p>
                </div>
              )}
              {(job.salary_min || job.salary_max) && (
                <div>
                  <span className="text-gray-400">Salary range</span>
                  <p className="font-medium">
                    {job.salary_min ? `$${job.salary_min.toLocaleString()}` : '?'}
                    {' – '}
                    {job.salary_max ? `$${job.salary_max.toLocaleString()}` : '?'}
                  </p>
                </div>
              )}
            </div>

            {/* Status picker */}
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Move to</p>
              <div className="flex gap-2 flex-wrap">
                {STATUSES.filter((s) => s !== job.status).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-gray-300
                               hover:bg-gray-50 text-gray-600 transition-colors capitalize"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-3">Notes</h3>
            <textarea
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Recruiter name, interview notes, follow-up tasks…"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">Auto-saved on click</span>
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {savingNotes ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>

          {/* Danger zone */}
          <div className="text-right">
            <button
              onClick={handleDelete}
              className="text-sm text-red-500 hover:text-red-700 hover:underline"
            >
              Delete application
            </button>
          </div>
        </div>

        {/* ── Right panel: AI tips ────────────────── */}
        <div className="w-96 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-6">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">AI Assistant</h3>
              {!job.job_description && (
                <p className="text-xs text-amber-600 mt-1">
                  Add a job description to enable AI tips.
                </p>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              {AI_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 text-xs py-2.5 font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* AI content */}
            <div className="p-5 min-h-[300px]">
              {!job.job_description ? (
                <p className="text-sm text-gray-400 text-center pt-12">
                  No job description provided.
                </p>
              ) : aiLoading ? (
                <div className="flex flex-col items-center gap-3 pt-12">
                  <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400">Claude is thinking…</p>
                </div>
              ) : aiData[activeTab] ? (
                <AiContent tab={activeTab} data={aiData[activeTab]} />
              ) : (
                <div className="flex flex-col items-center gap-3 pt-12">
                  <button
                    onClick={fetchAiTips}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Generate tips
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AiContent({ tab, data }) {
  if (tab === 'resume') {
    return (
      <ul className="space-y-3">
        {data.tips?.map((tip, i) => (
          <li key={i} className="flex gap-3 text-sm text-gray-700">
            <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full text-xs flex items-center justify-center font-bold">
              {i + 1}
            </span>
            {tip}
          </li>
        ))}
      </ul>
    )
  }

  if (tab === 'interview') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Likely questions</p>
          <ul className="space-y-2">
            {data.questions?.map((q, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-gray-400 flex-shrink-0">Q{i + 1}.</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prep tips</p>
          <ul className="space-y-2">
            {data.tips?.map((t, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-blue-400">•</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  if (tab === 'cover') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Key selling points</p>
          <ul className="space-y-1">
            {data.key_points?.map((p, i) => (
              <li key={i} className="text-sm text-green-700 flex gap-2">
                <span>✓</span> {p}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cover letter</p>
          <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{data.cover_letter}</p>
        </div>
      </div>
    )
  }

  return null
}
