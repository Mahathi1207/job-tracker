import { useState, useEffect } from 'react'
import api from '../api/axios'
import { triggerConfetti } from '../utils/confetti'

const LIMIT_OPTIONS = [10, 25, 50]
const APPLIED_KEY = 'applied_suggestions'
const PASSED_KEY  = 'passed_suggestions'

function getSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) }
  catch { return new Set() }
}
function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]))
}

export default function JobSuggestions({ keywords, resumeId }) {
  const [jobs, setJobs]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [limit, setLimit]           = useState(15)
  const [applied, setApplied]       = useState(() => getSet(APPLIED_KEY))
  const [passed, setPassed]         = useState(() => getSet(PASSED_KEY))
  const [pendingApply, setPendingApply] = useState(null)
  const [adding, setAdding]         = useState(false)

  useEffect(() => {
    if (!keywords) return
    let cancelled = false
    setLoading(true)
    api.get('/ai/job-suggestions', { params: { keywords, limit } })
      .then((res) => { if (!cancelled) setJobs(res.data.jobs || []) })
      .catch(() => { if (!cancelled) setJobs([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [keywords, limit])

  // When user returns to the tab after viewing a job, ask if they applied
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        const stored = localStorage.getItem('pending_application_check')
        if (stored) {
          setPendingApply(JSON.parse(stored))
          localStorage.removeItem('pending_application_check')
        }
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  function handleViewClick(job) {
    localStorage.setItem('pending_application_check', JSON.stringify({
      company: job.company,
      role: job.title,
      url: job.redirect_url,
    }))
  }

  async function handleConfirmApplied() {
    if (!pendingApply) return
    setAdding(true)
    try {
      const res = await api.post('/jobs', {
        company: pendingApply.company,
        role: pendingApply.role,
        status: 'applied',
        applied_date: new Date().toISOString().split('T')[0],
        ...(resumeId ? { resume_id: resumeId } : {}),
      })
      toggleApplied(pendingApply.url)
      setPendingApply(null)
      triggerConfetti(60)
      window.dispatchEvent(new CustomEvent('job-quick-added', { detail: res.data }))
    } catch (err) {
      console.error('Failed to add application', err)
    } finally {
      setAdding(false)
    }
  }

  function toggleApplied(url) {
    setApplied((prev) => {
      const next = new Set(prev)
      next.has(url) ? next.delete(url) : next.add(url)
      saveSet(APPLIED_KEY, next)
      return next
    })
  }

  function markPassed(url) {
    setPassed((prev) => {
      const next = new Set(prev)
      next.add(url)
      saveSet(PASSED_KEY, next)
      return next
    })
    setPendingApply(null)
  }

  if (!keywords) return null

  const newJobs      = jobs.filter((j) => !applied.has(j.redirect_url) && !passed.has(j.redirect_url))
  const passedJobs   = jobs.filter((j) => passed.has(j.redirect_url))
  const appliedJobs  = jobs.filter((j) => applied.has(j.redirect_url))
  const ordered      = [...newJobs, ...passedJobs, ...appliedJobs]

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-800">Today's Openings</h3>
          <p className="text-xs text-gray-400 mt-0.5">Matching "{keywords}" · US only</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
            Fortune 500 companies
          </span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>Show {n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* "Did you apply?" prompt */}
      {pendingApply && (
        <div className="mx-5 mt-4 mb-2 bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-blue-900 text-sm">Did you apply to {pendingApply.company}?</p>
            <p className="text-xs text-blue-500 mt-0.5 truncate max-w-[260px]">{pendingApply.role}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => markPassed(pendingApply.url)}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Let it go 👋
            </button>
            <button
              onClick={() => setPendingApply(null)}
              className="text-sm px-3 py-1.5 border border-blue-300 rounded-lg text-blue-700 hover:bg-blue-100 transition-colors"
            >
              Not yet
            </button>
            <button
              onClick={handleConfirmApplied}
              disabled={adding}
              className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
            >
              {adding ? 'Adding…' : 'Yes, I applied! 🎉'}
            </button>
          </div>
        </div>
      )}

      <div className="p-5">
        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">
            No US openings found — try broader keywords.
          </p>
        )}

        {!loading && jobs.length > 0 && (
          <>
            {(applied.size > 0 || passed.size > 0) && (
              <p className="text-xs text-gray-400 mb-3">
                {newJobs.length} new · {passedJobs.length} passed · {appliedJobs.length} applied
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2 pr-2 font-medium w-6">✓</th>
                    <th className="text-left pb-2 pr-4 font-medium">Role</th>
                    <th className="text-left pb-2 pr-4 font-medium">Company</th>
                    <th className="text-left pb-2 pr-4 font-medium hidden sm:table-cell">Location</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((job, i) => {
                    const isApplied = applied.has(job.redirect_url)
                    const isPassed  = passed.has(job.redirect_url)
                    return (
                      <tr
                        key={i}
                        className={`border-b border-gray-50 last:border-0 transition-colors ${
                          isApplied ? 'opacity-40' : isPassed ? 'opacity-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="py-2.5 pr-2">
                          <input
                            type="checkbox"
                            checked={isApplied}
                            onChange={() => toggleApplied(job.redirect_url)}
                            className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                            title={isApplied ? 'Mark as not applied' : 'Mark as applied'}
                          />
                        </td>
                        <td className="py-2.5 pr-4">
                          <p className={`font-medium truncate max-w-[180px] ${
                            isApplied ? 'line-through text-gray-400' :
                            isPassed  ? 'line-through text-gray-400' : 'text-gray-900'
                          }`}>
                            {job.title}
                          </p>
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600 truncate max-w-[140px]">{job.company}</td>
                        <td className="py-2.5 pr-4 text-gray-500 hidden sm:table-cell truncate max-w-[120px]">
                          {job.location || '—'}
                        </td>
                        <td className="py-2.5 text-right pl-4">
                          {isApplied ? (
                            <span className="text-xs text-green-600 font-medium">Applied ✓</span>
                          ) : isPassed ? (
                            <span className="text-xs text-gray-400 font-medium">Passed 👋</span>
                          ) : (
                            <a
                              href={job.redirect_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => handleViewClick(job)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium whitespace-nowrap"
                            >
                              View →
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
