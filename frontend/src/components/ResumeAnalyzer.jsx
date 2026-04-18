import { useState, useRef } from 'react'
import api from '../api/axios'

const PROB_COLORS = {
  High: { bar: 'bg-green-500', badge: 'bg-green-100 text-green-700', text: 'text-green-600' },
  Medium: { bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700', text: 'text-yellow-600' },
  Low: { bar: 'bg-red-500', badge: 'bg-red-100 text-red-700', text: 'text-red-600' },
}

function MatchRing({ percentage }) {
  const color =
    percentage >= 70 ? '#22c55e' : percentage >= 40 ? '#f59e0b' : '#ef4444'
  const r = 40
  const circ = 2 * Math.PI * r
  const dash = (percentage / 100) * circ

  return (
    <div className="flex flex-col items-center">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="55" cy="55" r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
        <text x="55" y="55" textAnchor="middle" dominantBaseline="middle"
          fontSize="20" fontWeight="bold" fill={color}>
          {percentage}%
        </text>
        <text x="55" y="72" textAnchor="middle" fontSize="9" fill="#9ca3af">
          MATCH
        </text>
      </svg>
    </div>
  )
}

function Tag({ label, color = 'bg-gray-100 text-gray-700' }) {
  return (
    <span className={`inline-block text-xs px-2 py-1 rounded-full font-medium ${color}`}>
      {label}
    </span>
  )
}

export default function ResumeAnalyzer() {
  const [open, setOpen] = useState(false)
  const [resumeFile, setResumeFile] = useState(null)
  const [resumeText, setResumeText] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [inputMode, setInputMode] = useState('file') // 'file' | 'text'
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef()

  async function handleAnalyze() {
    setError('')
    setResult(null)

    if (!jobDescription.trim()) {
      setError('Please paste the job description.')
      return
    }
    if (inputMode === 'file' && !resumeFile) {
      setError('Please upload your resume PDF.')
      return
    }
    if (inputMode === 'text' && resumeText.trim().length < 50) {
      setError('Please paste your resume text (at least 50 characters).')
      return
    }

    setLoading(true)
    try {
      const form = new FormData()
      form.append('job_description', jobDescription)
      if (inputMode === 'file') {
        form.append('resume_file', resumeFile)
      } else {
        form.append('resume_text', resumeText)
      }

      const res = await api.post('/ai/analyze-resume', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Analysis failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setResult(null)
    setResumeFile(null)
    setResumeText('')
    setJobDescription('')
    setError('')
  }

  const prob = result ? (PROB_COLORS[result.selection_probability] || PROB_COLORS.Medium) : null

  return (
    <>
      {/* Trigger button — always visible on Dashboard */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white
                   text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
      >
        <span className="text-base">🎯</span>
        Analyze Resume vs JD
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center
                        overflow-y-auto py-8 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Resume Analyzer</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Upload your resume + paste a job description — Claude will score the match
                </p>
              </div>
              <button onClick={() => { setOpen(false); reset() }}
                className="text-gray-400 hover:text-gray-600 text-xl font-light">✕</button>
            </div>

            <div className="p-6">
              {!result ? (
                /* ── Input form ── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Left: resume input */}
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Your Resume</p>

                    {/* Toggle */}
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 w-fit">
                      {['file', 'text'].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setInputMode(mode)}
                          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                            inputMode === mode
                              ? 'bg-indigo-600 text-white'
                              : 'text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {mode === 'file' ? '📄 Upload PDF' : '✏️ Paste Text'}
                        </button>
                      ))}
                    </div>

                    {inputMode === 'file' ? (
                      <div
                        onClick={() => fileRef.current.click()}
                        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center
                                   cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                      >
                        <input
                          ref={fileRef}
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={(e) => setResumeFile(e.target.files[0])}
                        />
                        {resumeFile ? (
                          <div>
                            <p className="text-2xl mb-1">📄</p>
                            <p className="text-sm font-medium text-indigo-600">{resumeFile.name}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {(resumeFile.size / 1024).toFixed(0)} KB — click to change
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-3xl mb-2">📤</p>
                            <p className="text-sm text-gray-500">Click to upload your resume PDF</p>
                            <p className="text-xs text-gray-400 mt-1">PDF only</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <textarea
                        rows={10}
                        value={resumeText}
                        onChange={(e) => setResumeText(e.target.value)}
                        placeholder="Paste your resume text here…"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      />
                    )}
                  </div>

                  {/* Right: job description */}
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Job Description</p>
                    <textarea
                      rows={inputMode === 'file' ? 13 : 13}
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      placeholder="Paste the full job description here…"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                  </div>
                </div>
              ) : (
                /* ── Results ── */
                <div className="space-y-5">

                  {/* Row 1: match ring + probability + overall */}
                  <div className="flex gap-5 items-start flex-wrap">
                    <MatchRing percentage={result.match_percentage} />

                    <div className="flex-1 space-y-3 min-w-[220px]">
                      {/* Selection probability */}
                      <div className={`rounded-xl p-4 ${prob.badge}`}>
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                          Selection Probability
                        </p>
                        <p className={`text-2xl font-bold mt-0.5 ${prob.text}`}>
                          {result.selection_probability}
                        </p>
                        <p className="text-xs mt-1 opacity-80">{result.probability_reasoning}</p>
                      </div>

                      {/* Overall assessment */}
                      <div className="bg-gray-50 rounded-xl p-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          Overall Assessment
                        </p>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {result.overall_assessment}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: keywords */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-green-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                        ✓ Keywords You Have
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.present_keywords.map((k) => (
                          <Tag key={k} label={k} color="bg-green-100 text-green-700" />
                        ))}
                      </div>
                    </div>

                    <div className="bg-red-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">
                        ✗ Missing Keywords
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.missing_keywords.map((k) => (
                          <Tag key={k} label={k} color="bg-red-100 text-red-700" />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Row 3: interview topics + improvements */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                        🎤 Likely Interview Topics
                      </p>
                      <ul className="space-y-1.5">
                        {result.interview_topics.map((t, i) => (
                          <li key={i} className="text-sm text-blue-800 flex gap-2">
                            <span className="font-bold">{i + 1}.</span> {t}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-amber-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                        ⚡ How to Improve Your Resume
                      </p>
                      <ul className="space-y-1.5">
                        {result.improvements.map((imp, i) => (
                          <li key={i} className="text-sm text-amber-800 flex gap-2">
                            <span>→</span> {imp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Strengths */}
                  <div className="bg-purple-50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">
                      💪 Your Strengths for This Role
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.strengths.map((s, i) => (
                        <span key={i}
                          className="text-sm bg-purple-100 text-purple-800 px-3 py-1 rounded-full">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  {result.cached && (
                    <p className="text-xs text-gray-400 text-right">⚡ Served from cache</p>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-6 justify-end">
                {result && (
                  <button onClick={reset}
                    className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg
                               text-sm hover:bg-gray-50 transition-colors">
                    Analyze Another
                  </button>
                )}
                {!result && (
                  <button
                    onClick={handleAnalyze}
                    disabled={loading}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg
                               text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading && (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent
                                       rounded-full animate-spin inline-block" />
                    )}
                    {loading ? 'Claude is analyzing…' : '🎯 Analyze Now'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
