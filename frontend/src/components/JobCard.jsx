import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import { differenceInDays, parseISO, format } from 'date-fns'
import api from '../api/axios'

const STATUS_COLORS = {
  applied: 'bg-blue-100 text-blue-700',
  interviewing: 'bg-yellow-100 text-yellow-700',
  offer: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function JobCard({ job, onJobUpdated }) {
  const navigate = useNavigate()
  const [marking, setMarking] = useState(false)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { job },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  const daysSince =
    job.applied_date
      ? differenceInDays(new Date(), parseISO(job.applied_date))
      : null

  const needsFollowUp = (() => {
    if (!job.applied_date || job.status === 'offer' || job.status === 'rejected') return false
    const threshold = job.status === 'applied' ? 14 : 7
    if (differenceInDays(new Date(), parseISO(job.applied_date)) < threshold) return false
    if (job.updated_at && differenceInDays(new Date(), parseISO(job.updated_at)) < threshold) return false
    return true
  })()

  async function handleMarkFollowedUp(e) {
    e.stopPropagation()
    setMarking(true)
    try {
      const res = await api.post(`/jobs/${job.id}/mark-followed-up`)
      onJobUpdated?.(res.data)
    } catch (err) {
      console.error('Failed to mark followed up', err)
    } finally {
      setMarking(false)
    }
  }

  const upcomingInterview =
    job.interview_at && new Date(job.interview_at) > new Date()
      ? parseISO(job.interview_at)
      : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => navigate(`/jobs/${job.id}`)}
      className={`bg-white rounded-lg border p-4 shadow-sm hover:shadow-md
                 transition-shadow select-none group
                 ${needsFollowUp ? 'border-orange-300' : 'border-gray-200'}`}
    >
      {needsFollowUp && (
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-orange-500 font-medium">⚠ Follow-up needed</p>
          <button
            onClick={handleMarkFollowedUp}
            disabled={marking}
            className="text-xs text-orange-500 hover:text-orange-700 border border-orange-200 rounded px-1.5 py-0.5 hover:bg-orange-50 transition-colors disabled:opacity-50"
          >
            {marking ? '…' : 'Done ✓'}
          </button>
        </div>
      )}

      <p className="font-semibold text-gray-900 truncate">{job.company}</p>
      <p className="text-sm text-gray-500 truncate mt-0.5">{job.role}</p>

      {upcomingInterview && (
        <p className="text-xs text-purple-600 mt-2 font-medium">
          📅 {format(upcomingInterview, 'MMM d, h:mm a')}
        </p>
      )}

      {(job.salary_min || job.salary_max) && (
        <p className="text-xs text-gray-400 mt-2">
          {job.salary_min ? `$${(job.salary_min / 1000).toFixed(0)}k` : '?'}
          {' – '}
          {job.salary_max ? `$${(job.salary_max / 1000).toFixed(0)}k` : '?'}
        </p>
      )}

      <div className="flex items-center justify-between mt-3">
        {daysSince !== null && (
          <span className="text-xs text-gray-400">
            {daysSince === 0 ? 'Today' : `${daysSince}d ago`}
          </span>
        )}
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ml-auto ${STATUS_COLORS[job.status]}`}
        >
          {job.status}
        </span>
      </div>
    </div>
  )
}
