import { useState, useRef } from 'react'
import api from '../api/axios'

const APP_FIELDS = [
  { key: 'company',         label: 'Company',          required: true },
  { key: 'role',            label: 'Role / Job Title', required: true },
  { key: 'status',          label: 'Status',           hint: 'applied / interviewing / offer / rejected' },
  { key: 'applied_date',    label: 'Applied Date',     hint: 'YYYY-MM-DD or MM/DD/YYYY' },
  { key: 'location',        label: 'Location' },
  { key: 'salary_min',      label: 'Salary Min' },
  { key: 'salary_max',      label: 'Salary Max' },
  { key: 'deadline',        label: 'Deadline' },
  { key: 'notes',           label: 'Notes' },
  { key: 'job_description', label: 'Job Description' },
]

export default function CsvImport({ onImported }) {
  const [step, setStep] = useState('upload')   // upload | map | done
  const [headers, setHeaders] = useState([])
  const [file, setFile] = useState(null)
  const [mapping, setMapping] = useState({})   // appField → csvColumn
  const [result, setResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef()

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const firstLine = text.split('\n')[0]
      const cols = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
      setHeaders(cols)
      // Auto-map by fuzzy matching
      const autoMap = {}
      APP_FIELDS.forEach(({ key }) => {
        const match = cols.find((c) =>
          c.toLowerCase().replace(/[^a-z]/g, '').includes(key.replace(/_/g, ''))
          || key.replace(/_/g, '').includes(c.toLowerCase().replace(/[^a-z]/g, ''))
        )
        if (match) autoMap[key] = match
      })
      setMapping(autoMap)
      setStep('map')
    }
    reader.readAsText(f)
  }

  async function handleImport() {
    const missing = APP_FIELDS.filter((f) => f.required && !mapping[f.key])
    if (missing.length) {
      setError(`Please map required fields: ${missing.map((f) => f.label).join(', ')}`)
      return
    }
    setImporting(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(
        `/jobs/import-csv?mapping=${encodeURIComponent(JSON.stringify(mapping))}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setResult(res.data)
      setStep('done')
      onImported?.()
    } catch (err) {
      setError(err.response?.data?.detail || 'Import failed. Check your CSV file.')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep('upload')
    setHeaders([])
    setFile(null)
    setMapping({})
    setResult(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
      {step === 'upload' && (
        <>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Import from CSV</h3>
          <p className="text-sm text-gray-500 mb-5">
            Upload any CSV file — you'll map your columns to our fields next.
            No need to rename anything first.
          </p>
          <label className="block w-full border-2 border-dashed border-gray-300 rounded-xl p-8
                            text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
            <span className="text-3xl block mb-2">📂</span>
            <span className="text-sm font-medium text-gray-600">Click to choose a CSV file</span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
          </label>
        </>
      )}

      {step === 'map' && (
        <>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Match your columns</h3>
          <p className="text-sm text-gray-500 mb-4">
            We auto-detected some matches. Fix any that look wrong.
          </p>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {APP_FIELDS.map(({ key, label, required, hint }) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-36 flex-shrink-0">
                  <p className="text-sm font-medium text-gray-700">
                    {label}
                    {required && <span className="text-red-500 ml-0.5">*</span>}
                  </p>
                  {hint && <p className="text-xs text-gray-400">{hint}</p>}
                </div>
                <select
                  value={mapping[key] || ''}
                  onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— skip —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
          <div className="flex gap-3 mt-5">
            <button onClick={reset}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">
              Back
            </button>
            <button onClick={handleImport} disabled={importing}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <div className="text-center py-4">
          <div className="text-5xl mb-3">✅</div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Import complete!</h3>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-green-600">{result.imported}</span> jobs imported
            {result.skipped > 0 && (
              <>, <span className="text-gray-400">{result.skipped} skipped</span> (missing company or role)</>
            )}
          </p>
          <button onClick={reset}
            className="mt-5 text-sm text-blue-600 hover:underline">
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}
