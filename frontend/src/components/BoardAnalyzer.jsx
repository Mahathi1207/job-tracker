import { useState, useEffect, useRef } from 'react'
import api from '../api/axios'

export default function BoardAnalyzer({ resumeId }) {
  const [storedText, setStoredText] = useState('')
  const [jd, setJd]               = useState('')
  const [result, setResult]        = useState(null)
  const [loading, setLoading]      = useState(false)
  const [uploading, setUploading]  = useState(false)
  const [error, setError]          = useState('')
  const fileRef = useRef()

  useEffect(() => {
    setStoredText(localStorage.getItem(`board_resume_${resumeId}`) || '')
    setResult(null)
    setJd('')
  }, [resumeId])

  async function handleUploadPdf(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/ai/extract-resume-text', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      localStorage.setItem(`board_resume_${resumeId}`, res.data.text)
      setStoredText(res.data.text)
      setResult(null)
    } catch {
      setError('Failed to read PDF. Try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleAnalyze() {
    if (!jd.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await api.post('/ai/ats-score', {
        resume_text: storedText,
        job_description: jd,
      })
      setResult(res.data)
    } catch {
      setError('Analysis failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!storedText) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
        <h3 className="font-semibold text-gray-800 mb-1">Resume Analyzer</h3>
        <p className="text-sm text-gray-500 mb-4">
          No resume uploaded for this board yet. Upload your PDF to enable instant job match analysis.
        </p>
        <label className="cursor-pointer inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {uploading ? 'Reading PDF…' : 'Upload Resume PDF'}
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUploadPdf} disabled={uploading} />
        </label>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">Analyze Job Match</h3>
        <label className="text-xs text-blue-600 hover:underline cursor-pointer">
          Change resume PDF
          <input type="file" accept=".pdf" className="hidden" onChange={handleUploadPdf} disabled={uploading} />
        </label>
      </div>

      {!result ? (
        <>
          <textarea
            rows={4}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the job description here…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
          />
          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
          <button
            onClick={handleAnalyze}
            disabled={loading || !jd.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : 'Analyze Match'}
          </button>
        </>
      ) : (
        <div className="space-y-4">

          {/* Score + Verdict row */}
          <div className="flex gap-3">
            {/* Score ring */}
            <div className={`flex-1 rounded-xl p-4 text-center ${
              result.score >= 60 ? 'bg-green-50' : result.score >= 35 ? 'bg-yellow-50' : 'bg-red-50'
            }`}>
              <p className={`text-4xl font-bold ${
                result.score >= 60 ? 'text-green-600' : result.score >= 35 ? 'text-yellow-600' : 'text-red-600'
              }`}>{result.score}%</p>
              <p className="text-xs text-gray-500 mt-0.5">ATS Match</p>
            </div>

            {/* Verdict card */}
            {result.verdict && (() => {
              const cfg = {
                go:    { emoji: '🚀', label: 'Go for it!',    bg: 'bg-green-50',  border: 'border-green-300', text: 'text-green-700' },
                maybe: { emoji: '🤔', label: 'Could work…',   bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700' },
                skip:  { emoji: '🙅', label: 'Skip this one', bg: 'bg-red-50',    border: 'border-red-300',   text: 'text-red-700'   },
              }[result.verdict] || { emoji: '🤔', label: 'Maybe', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' }
              return (
                <div className={`flex-1 rounded-xl p-4 border-2 ${cfg.bg} ${cfg.border} flex flex-col items-center justify-center text-center`}>
                  <span className="text-3xl mb-1">{cfg.emoji}</span>
                  <p className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</p>
                  {result.verdict_reason && (
                    <p className="text-xs text-gray-500 mt-1 leading-snug">{result.verdict_reason}</p>
                  )}
                </div>
              )
            })()}
          </div>

          {/* Keywords */}
          <div className="grid grid-cols-2 gap-3">
            {result.matched_keywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">✅ Matched</p>
                <div className="flex flex-wrap gap-1">
                  {result.matched_keywords.map((k, i) => (
                    <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{k}</span>
                  ))}
                </div>
              </div>
            )}
            {result.missing_keywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">❌ Missing</p>
                <div className="flex flex-wrap gap-1">
                  {result.missing_keywords.map((k, i) => (
                    <span key={i} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{k}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Resume suggestions */}
          {result.suggestions?.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-2">
                ✍️ Add these to boost your score
              </p>
              <ul className="space-y-2">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs text-blue-700">
                    <span className="flex-shrink-0 w-4 h-4 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-[10px]">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setJd('') }}
            className="w-full text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg py-1.5 transition-colors"
          >
            Analyze another job
          </button>
        </div>
      )}
    </div>
  )
}
