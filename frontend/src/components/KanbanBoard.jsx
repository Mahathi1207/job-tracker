import { useState } from 'react'
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import JobCard from './JobCard'
import api from '../api/axios'

const COLUMNS = [
  { id: 'applied', label: 'Applied', color: 'border-blue-400' },
  { id: 'interviewing', label: 'Interviewing', color: 'border-yellow-400' },
  { id: 'offer', label: 'Offer', color: 'border-green-400' },
  { id: 'rejected', label: 'Rejected', color: 'border-red-400' },
]

function Column({ id, label, color, jobs, onJobUpdated }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[240px] rounded-xl border-t-4 ${color}
                  ${isOver ? 'bg-blue-50' : 'bg-gray-100'} transition-colors`}
    >
      {/* Column header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">{label}</h3>
        <span className="text-xs bg-white text-gray-500 rounded-full px-2 py-0.5 font-medium shadow-sm">
          {jobs.length}
        </span>
      </div>

      {/* Cards */}
      <div className="px-3 pb-4 flex flex-col gap-3 min-h-[120px]">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onJobUpdated={onJobUpdated} />
        ))}
        {jobs.length === 0 && (
          <p className="text-xs text-center text-gray-400 pt-6">Drop here</p>
        )}
      </div>
    </div>
  )
}

export default function KanbanBoard({ jobs, onJobUpdated }) {
  const [activeJob, setActiveJob] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // Group jobs by status for each column
  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.id] = jobs.filter((j) => j.status === col.id)
    return acc
  }, {})

  function handleDragStart({ active }) {
    setActiveJob(active.data.current?.job ?? null)
  }

  async function handleDragEnd({ active, over }) {
    setActiveJob(null)
    if (!over || active.id === over.id) return

    const newStatus = over.id // column id is the status
    const job = jobs.find((j) => j.id === active.id)
    if (!job || job.status === newStatus) return

    try {
      const res = await api.patch(`/jobs/${active.id}/status`, { status: newStatus })
      onJobUpdated(res.data)
    } catch (err) {
      console.error('Failed to update job status', err)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <Column key={col.id} {...col} jobs={grouped[col.id]} onJobUpdated={onJobUpdated} />
        ))}
      </div>

      {/* Ghost card rendered at cursor during drag */}
      <DragOverlay>
        {activeJob ? (
          <div className="rotate-2 shadow-2xl scale-105">
            <JobCard job={activeJob} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
