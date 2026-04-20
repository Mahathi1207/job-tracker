import { useState, useEffect } from 'react'
import api from '../api/axios'
import KanbanBoard from '../components/KanbanBoard'
import ResumeAnalyzer from '../components/ResumeAnalyzer'
import ResumeBoard from '../components/ResumeBoard'

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected']

export default function Dashboard() {
  const [jobs, setJobs] = useState([])
  const [resumes, setResumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')   // 'all' | resume.id
  const [showForm, setShowForm] = useState(false)
  const [showAddResume, setShowAddResume] = useState(false)
  const [form, setForm] = useState({
    company: '', role: '', status: 'applied',
    salary_min: '', salary_max: '', deadline: '', job_description: '',
  })
  const [resumeForm, setResumeForm] = useState({ name: '', keywords: '' })
  const [submitting, setSubmitting] = useState(false)
  const [addingResume, setAddingResume] = useState(false)

  useEffect(() => {
    Promise.all([fetchJobs(), fetchResumes()]).finally(() => setLoading(false))
  }, [])

  async function fetchJobs() {
    try {
      const res = await api.get('/jobs')
      setJobs(res.data)
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
        deadline: form.deadline || null,
        job_description: form.job_description || null,
      }
      const res = await api.post('/jobs', payload)
      setJobs((prev) => [res.data, ...prev])
      setShowForm(false)
      setForm({ company: '', role: '', status: 'applied', salary_min: '', salary_max: '', deadline: '', job_description: '' })
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
      setResumes((prev) => [...prev, res.data])
      setActiveTab(res.data.id)
      setShowAddResume(false)
      setResumeForm({ name: '', keywords: '' })
    } catch (err) {
      console.error('Failed to add resume', err)
    } finally {
      setAddingResume(false)
    }
  }

  const totalApplied = jobs.length
  const totalInterviewing = jobs.filter((j) => j.status === 'interviewing').length
  const totalOffers = jobs.filter((j) => j.status === 'offer').length
  const responseRate = totalApplied
    ? Math.round(((totalInterviewing + totalOffers) / totalApplied) * 100)
    : 0

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
          { label: 'Total Applied', value: totalApplied, color: 'text-blue-600' },
          { label: 'Interviewing', value: totalInterviewing, color: 'text-yellow-600' },
          { label: 'Offers', value: totalOffers, color: 'text-green-600' },
          { label: 'Response Rate', value: `${responseRate}%`, color: 'text-purple-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Resume tabs — only shown when user has at least one resume */}
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

      {/* ── Resume board view ── */}
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
          {/* ── Default "All" board ── */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              {resumes.length === 0 ? 'Kanban Board' : 'All Applications'}
            </h2>
            <div className="flex items-center gap-3">
              <ResumeAnalyzer />
              {resumes.length === 0 && (
                <button
                  onClick={() => setShowAddResume(true)}
                  className="border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  + Add Resume Board
                </button>
              )}
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + Add Application
              </button>
            </div>
          </div>
          <KanbanBoard jobs={jobs} onJobUpdated={handleJobUpdated} />
        </>
      )}

      {/* Add Job modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
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
                <label className="text-xs font-medium text-gray-600">Deadline</label>
                <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
