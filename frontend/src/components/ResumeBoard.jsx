import { useState } from 'react'
import api from '../api/axios'
import KanbanBoard from './KanbanBoard'
import JobSuggestions from './JobSuggestions'
import BoardAnalyzer from './BoardAnalyzer'

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected']

export default function ResumeBoard({ resume, jobs, allJobs, onJobUpdated, onJobAdded, onResumeDeleted }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    company: '', role: '', status: 'applied',
    salary_min: '', salary_max: '', deadline: '', job_description: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: resume.name, keywords: resume.keywords || '' })
  const [saving, setSaving] = useState(false)

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
        resume_id: resume.id,
      }
      const res = await api.post('/jobs', payload)
      onJobAdded(res.data)
      setShowForm(false)
      setForm({ company: '', role: '', status: 'applied', salary_min: '', salary_max: '', deadline: '', job_description: '' })
    } catch (err) {
      console.error('Failed to add job', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveEdit() {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      await api.patch(`/resumes/${resume.id}`, editForm)
      resume.name     = editForm.name
      resume.keywords = editForm.keywords || null
      setEditing(false)
      window.location.reload()
    } catch (err) {
      console.error('Failed to update resume board', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteResume() {
    try {
      await api.delete(`/resumes/${resume.id}`)
      onResumeDeleted(resume.id)
    } catch (err) {
      console.error('Failed to delete resume', err)
    }
  }

  const boardJobs = jobs.filter((j) => j.resume_id === resume.id)
  const keywords = resume.keywords?.trim() || ''

  return (
    <div>
      {/* Today's openings — only shown when explicit keywords are set */}
      <BoardAnalyzer resumeId={resume.id} />

      {keywords ? (
        <JobSuggestions keywords={keywords} resumeId={resume.id} />
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6 text-sm text-amber-700">
          Add <strong>job search keywords</strong> to this board to see matching openings.
          Edit the board name and add keywords like <em>"React frontend engineer"</em> or <em>"Python backend"</em>.
        </div>
      )}

      {/* Board header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Board name"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={editForm.keywords}
                onChange={(e) => setEditForm({ ...editForm, keywords: e.target.value })}
                placeholder="Keywords (e.g. frontend engineer)"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} disabled={saving}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)}
                  className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-bold text-gray-900">{resume.name}</h2>
              {resume.keywords && (
                <p className="text-xs text-gray-400 mt-0.5">Keywords: {resume.keywords}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && !confirmDelete && (
            <button
              onClick={() => { setEditForm({ name: resume.name, keywords: resume.keywords || '' }); setEditing(true) }}
              className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              Edit board
            </button>
          )}
          {confirmDelete ? (
            <>
              <span className="text-xs text-gray-500">Delete this resume board?</span>
              <button
                onClick={handleDeleteResume}
                className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Delete board
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + Add Application
              </button>
            </>
          )}
        </div>
      </div>

      {boardJobs.length === 0 && (
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 py-12 text-center mb-4">
          <p className="text-gray-400 text-sm">No applications on this board yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 text-sm text-blue-600 hover:underline"
          >
            Add your first application →
          </button>
        </div>
      )}

      <KanbanBoard jobs={boardJobs} onJobUpdated={onJobUpdated} />

      {/* Add job modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">New Application</h3>
                <p className="text-xs text-blue-600 mt-0.5">Board: {resume.name}</p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleAddJob} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Company *</label>
                  <input
                    required
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Google"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Role *</label>
                  <input
                    required
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Software Engineer"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Salary Min</label>
                  <input
                    type="number"
                    value={form.salary_min}
                    onChange={(e) => setForm({ ...form, salary_min: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="90000"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Salary Max</label>
                  <input
                    type="number"
                    value={form.salary_max}
                    onChange={(e) => setForm({ ...form, salary_max: e.target.value })}
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="130000"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Deadline</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Job Description (for AI tips)</label>
                <textarea
                  rows={3}
                  value={form.job_description}
                  onChange={(e) => setForm({ ...form, job_description: e.target.value })}
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Paste the job description here…"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
