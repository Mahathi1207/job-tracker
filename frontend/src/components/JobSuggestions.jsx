import { useState, useEffect } from 'react'
import api from '../api/axios'

export default function JobSuggestions({ keywords }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState('')

  useEffect(() => {
    if (!keywords) return
    let cancelled = false

    async function fetch() {
      setLoading(true)
      try {
        const res = await api.get('/ai/job-suggestions', { params: { keywords } })
        if (!cancelled) {
          setJobs(res.data.jobs || [])
          setSource(res.data.source || '')
        }
      } catch {
        if (!cancelled) setJobs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    return () => { cancelled = true }
  }, [keywords])

  if (!keywords) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800">Today's Openings</h3>
          <p className="text-xs text-gray-400 mt-0.5">Matching "{keywords}"</p>
        </div>
        {source === 'remotive' && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Remote only</span>
        )}
        {source === 'adzuna' && (
          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">All locations</span>
        )}
      </div>

      <div className="p-5">
        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">
            No openings found today — check back tomorrow!
          </p>
        )}

        {!loading && jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 pr-4 font-medium">Role</th>
                  <th className="text-left pb-2 pr-4 font-medium">Company</th>
                  <th className="text-left pb-2 pr-4 font-medium hidden sm:table-cell">Location</th>
                  <th className="text-left pb-2 font-medium hidden md:table-cell">Salary</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 pr-4">
                      <p className="font-medium text-gray-900 truncate max-w-[180px]">{job.title}</p>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 truncate max-w-[140px]">{job.company}</td>
                    <td className="py-2.5 pr-4 text-gray-500 hidden sm:table-cell truncate max-w-[120px]">
                      {job.location}
                    </td>
                    <td className="py-2.5 text-gray-500 hidden md:table-cell">
                      {job.salary_min
                        ? `$${Math.round(job.salary_min / 1000)}k${job.salary_max ? ` – $${Math.round(job.salary_max / 1000)}k` : '+'}`
                        : '–'}
                    </td>
                    <td className="py-2.5 text-right pl-4">
                      <a
                        href={job.redirect_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium whitespace-nowrap"
                      >
                        View →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
