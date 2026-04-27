import { useMemo, useState } from 'react'
import { format, subDays, startOfDay, parseISO, startOfWeek, addDays } from 'date-fns'

// Light: gray → purple  |  Dark: gray → neon green
const LIGHT = ['#f3f4f6', '#ede9fe', '#c4b5fd', '#7c3aed', '#4c1d95']
const DARK  = ['#1f2937', '#052e16', '#166534', '#15803d', '#00ff88']

function getLevel(count) {
  if (count === 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  return 4
}

export default function Heatmap({ jobs }) {
  const [tooltip, setTooltip] = useState(null)
  const isDark = document.documentElement.classList.contains('dark')
  const colors = isDark ? DARK : LIGHT

  const today = startOfDay(new Date())

  // Build date → count map
  const counts = useMemo(() => {
    const map = {}
    jobs.forEach((j) => {
      const d = j.applied_date || j.created_at?.slice(0, 10)
      if (d) map[d] = (map[d] || 0) + 1
    })
    return map
  }, [jobs])

  // Build 52 weeks of columns (each column = Mon–Sun)
  const weeks = useMemo(() => {
    const result = []
    // Go back to the Monday 51 weeks ago
    const gridEnd = today
    const gridStart = subDays(startOfWeek(today, { weekStartsOn: 1 }), 51 * 7)

    let current = gridStart
    while (current <= gridEnd) {
      const week = []
      for (let d = 0; d < 7; d++) {
        const date = addDays(current, d)
        if (date > today) { week.push(null); continue }
        const dateStr = format(date, 'yyyy-MM-dd')
        week.push({ date, dateStr, count: counts[dateStr] || 0 })
      }
      result.push(week)
      current = addDays(current, 7)
    }
    return result
  }, [counts, today])

  // Month labels
  const monthLabels = useMemo(() => {
    const labels = []
    let lastMonth = null
    weeks.forEach((week, wi) => {
      const firstDay = week.find(Boolean)
      if (!firstDay) return
      const m = format(firstDay.date, 'MMM')
      if (m !== lastMonth) { labels.push({ label: m, col: wi }); lastMonth = m }
    })
    return labels
  }, [weeks])

  const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

  return (
    <div className="overflow-x-auto pb-2">
      {/* Month labels */}
      <div className="flex gap-[3px] mb-1 ml-7">
        {weeks.map((_, wi) => {
          const ml = monthLabels.find((m) => m.col === wi)
          return (
            <div key={wi} className="w-[13px] text-[9px] text-gray-400 overflow-visible whitespace-nowrap">
              {ml ? ml.label : ''}
            </div>
          )
        })}
      </div>

      <div className="flex gap-[3px]">
        {/* Day labels */}
        <div className="flex flex-col gap-[3px] mr-1">
          {DAY_LABELS.map((d, i) => (
            <div key={i} className="h-[13px] text-[9px] text-gray-400 flex items-center w-6">{d}</div>
          ))}
        </div>

        {/* Grid */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((cell, di) =>
              cell ? (
                <div
                  key={cell.dateStr}
                  style={{ backgroundColor: colors[getLevel(cell.count)] }}
                  className="w-[13px] h-[13px] rounded-sm cursor-pointer transition-transform hover:scale-125"
                  onMouseEnter={(e) =>
                    setTooltip({
                      text: `${format(cell.date, 'MMM d, yyyy')}: ${cell.count} app${cell.count !== 1 ? 's' : ''}`,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onMouseLeave={() => setTooltip(null)}
                />
              ) : (
                <div key={di} className="w-[13px] h-[13px]" />
              )
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-3 ml-7">
        <span className="text-[10px] text-gray-400 mr-1">Less</span>
        {colors.map((c, i) => (
          <div key={i} style={{ backgroundColor: c }} className="w-[13px] h-[13px] rounded-sm" />
        ))}
        <span className="text-[10px] text-gray-400 ml-1">More</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1 text-xs rounded shadow-lg pointer-events-none"
          style={{
            left: tooltip.x + 10,
            top: tooltip.y - 30,
            background: isDark ? '#0f1117' : '#1f2937',
            color: '#fff',
            border: isDark ? '1px solid #00ff8844' : 'none',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
