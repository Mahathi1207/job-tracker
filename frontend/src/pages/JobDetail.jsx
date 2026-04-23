import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import api from '../api/axios'

async function fetchResumes() {
  try {
    const res = await api.get('/resumes')
    return res.data
  } catch {
    return []
  }
}

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected']

const STATUS_BADGE = {
  applied: 'bg-blue-100 text-blue-700',
  interviewing: 'bg-yellow-100 text-yellow-700',
  offer: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const ALL_AI_TABS = [
  { key: 'interview', label: 'Interview Prep', endpoint: '/ai/interview-prep', statuses: ['applied', 'interviewing'] },
  { key: 'cover', label: 'Cover Letter', endpoint: '/ai/cover-letter', statuses: ['applied', 'interviewing', 'offer'] },
]

function getTabsForStatus(status) {
  return ALL_AI_TABS.filter((t) => t.statuses.includes(status))
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('interview')
  const [aiData, setAiData] = useState({})
  const [aiLoading, setAiLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [resumes, setResumes] = useState([])
  const [movingBoard, setMovingBoard] = useState(false)
  const [interviewAt, setInterviewAt] = useState('')
  const [savingInterview, setSavingInterview] = useState(false)
  const [resumeText, setResumeText] = useState(
    () => localStorage.getItem('ats_resume_text') || ''
  )

  useEffect(() => {
    fetchJob()
    fetchResumes().then(setResumes)
  }, [id])

  async function fetchJob() {
    try {
      const res = await api.get(`/jobs/${id}`)
      setJob(res.data)
      setNotes(res.data.notes || '')
      setInterviewAt(res.data.interview_at ? res.data.interview_at.slice(0, 16) : '')
    } catch {
      navigate('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  async function fetchAiTips() {
    if (!job?.job_description) return
    const tab = getTabsForStatus(job.status).find((t) => t.key === activeTab)
    if (!tab || aiData[activeTab]) return

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

  useEffect(() => {
    if (job) fetchAiTips()
  }, [activeTab, job])

  async function fetchAtsScore() {
    if (!job?.job_description || !resumeText.trim()) return
    localStorage.setItem('ats_resume_text', resumeText)
    setAiLoading(true)
    try {
      const res = await api.post('/ai/ats-score', {
        resume_text: resumeText,
        job_description: job.job_description,
      })
      setAiData((prev) => ({ ...prev, ats: res.data }))
    } catch (err) {
      console.error('ATS score failed', err)
    } finally {
      setAiLoading(false)
    }
  }

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

  async function handleSaveInterviewAt() {
    setSavingInterview(true)
    try {
      const res = await api.patch(`/jobs/${id}`, { interview_at: interviewAt || null })
      setJob(res.data)
    } catch (err) {
      console.error('Failed to save interview date', err)
    } finally {
      setSavingInterview(false)
    }
  }

  async function handleMoveBoard(resumeId) {
    setMovingBoard(true)
    try {
      const res = await api.patch(`/jobs/${id}`, { resume_id: resumeId || null })
      setJob(res.data)
    } catch (err) {
      console.error('Failed to move board', err)
    } finally {
      setMovingBoard(false)
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
      <button
        onClick={() => navigate('/dashboard')}
        className="text-sm text-blue-600 hover:underline mb-4 flex items-center gap-1"
      >
        ← Back to Dashboard
      </button>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Left panel ─────────────────────────────────────── */}
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

            {/* Interview date */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Interview Date & Time</p>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={interviewAt}
                  onChange={(e) => setInterviewAt(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSaveInterviewAt}
                  disabled={savingInterview}
                  className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  {savingInterview ? '…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Resume board assignment */}
            {resumes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Resume Board</p>
                <select
                  value={job.resume_id || ''}
                  onChange={(e) => handleMoveBoard(e.target.value)}
                  disabled={movingBoard}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">— No board (All Applications) —</option>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
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

        {/* ── Right panel: AI assistant (hidden for rejected) ─── */}
        {job.status !== 'rejected' && (
          <div className="w-full lg:w-96 lg:flex-shrink-0">
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
                {getTabsForStatus(job.status).map((tab) => (
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
                    <p className="text-xs text-gray-400">Thinking…</p>
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
        )}
      </div>
    </div>
  )
}

function AtsScorePanel({ data, loading, resumeText, onResumeTextChange, onScore, onRescore }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 pt-12">
        <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-gray-400">Analyzing your resume…</p>
      </div>
    )
  }

  if (data) {
    const scoreColor =
      data.score >= 70 ? 'text-green-600' : data.score >= 40 ? 'text-yellow-600' : 'text-red-600'
    const bgColor =
      data.score >= 70 ? 'bg-green-50' : data.score >= 40 ? 'bg-yellow-50' : 'bg-red-50'

    return (
      <div className="space-y-4">
        <div className={`${bgColor} rounded-xl p-4 text-center`}>
          <p className={`text-5xl font-bold ${scoreColor}`}>{data.score}%</p>
          <p className="text-xs text-gray-500 mt-1">ATS Match Score</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Matched</p>
          <div className="flex flex-wrap gap-1.5">
            {data.matched_keywords.map((k, i) => (
              <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{k}</span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Missing</p>
          <div className="flex flex-wrap gap-1.5">
            {data.missing_keywords.map((k, i) => (
              <span key={i} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{k}</span>
            ))}
          </div>
        </div>

        <button
          onClick={onRescore}
          className="w-full text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg py-1.5 transition-colors"
        >
          Re-score with different resume
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Paste your resume to score it against this job description.
        {resumeText && ' Your last resume is pre-filled.'}
      </p>
      <textarea
        rows={7}
        value={resumeText}
        onChange={(e) => onResumeTextChange(e.target.value)}
        placeholder="Paste your resume text here…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs resize-none
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        onClick={onScore}
        disabled={!resumeText.trim()}
        className="w-full text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        Score My Resume
      </button>
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
