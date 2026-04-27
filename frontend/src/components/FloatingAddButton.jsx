import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api from '../api/axios'

const STATUSES = ['applied', 'interviewing', 'offer', 'rejected']

export default function FloatingAddButton({ onJobAdded }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    company: '', role: '', status: 'applied',
    applied_date: new Date().toISOString().split('T')[0],
  })
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await api.post('/jobs', { ...form, applied_date: form.applied_date || null })
      setOpen(false)
      setForm({ company: '', role: '', status: 'applied', applied_date: new Date().toISOString().split('T')[0] })
      if (location.pathname === '/dashboard') {
        window.dispatchEvent(new CustomEvent('job-quick-added', { detail: res.data }))
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      console.error('Quick add failed', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-blue-600
                   text-white text-3xl shadow-xl flex items-center justify-center
                   hover:scale-110 transition-transform active:scale-95"
        title="Quick add application"
      >
        +
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Quick Add ⚡</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                required
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Company *"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                required
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Role / Job Title *"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  type="date"
                  value={form.applied_date}
                  onChange={(e) => setForm({ ...form, applied_date: e.target.value })}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {submitting ? 'Adding…' : 'Add Application ⚡'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
