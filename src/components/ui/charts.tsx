import { cn } from "@/lib/utils"

interface SparklineProps {
  points: number[]
  labels?: string[]
  height?: number
  stroke?: string
  fill?: string
  className?: string
}

export function Sparkline({ points, labels, height = 140, stroke = "#22c55e", fill = "rgba(34,197,94,0.12)", className }: SparklineProps) {
  if (points.length === 0) {
    return <div className={cn("flex items-center justify-center text-xs text-surface-400", className)} style={{ height }}>No trend data yet</div>
  }

  const width = 100
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const step = points.length > 1 ? width / (points.length - 1) : 0

  const coords = points.map((p, i) => ({ x: i * step, y: 100 - ((p - min) / range) * 100 }))
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ")
  const area = `${line} L${width},100 L0,100 Z`

  return (
    <div className={className}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: "100%" }}>
        <path d={area} fill={fill} stroke="none" />
        <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={1.6} fill={stroke} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between text-[10px] text-surface-400">
          {labels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
    </div>
  )
}

interface RadialGaugeProps {
  value: number
  size?: number
  strokeWidth?: number
  trackClassName?: string
  progressClassName?: string
  children?: React.ReactNode
}

export function RadialGauge({ value, size = 168, strokeWidth = 14, trackClassName = "stroke-white/10", progressClassName = "stroke-success-400", children }: RadialGaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(Math.max(value, 0), 100)
  const dash = (pct / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} fill="none" className={trackClassName} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
          className={cn("transition-all duration-700 ease-out", progressClassName)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  )
}

export interface DonutSegment { label: string; value: number; className: string }

interface DonutProps {
  segments: DonutSegment[]
  size?: number
  strokeWidth?: number
  centerLabel?: React.ReactNode
}

export function Donut({ segments, size = 96, strokeWidth = 14, centerLabel }: DonutProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1

  const arcs = segments.reduce<{ label: string; className: string; dash: number; offset: number }[]>((acc, seg) => {
    const dash = (seg.value / total) * circumference
    const offset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0
    return [...acc, { label: seg.label, className: seg.className, dash, offset }]
  }, [])

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {arcs.map((seg) => (
          <circle
            key={seg.label} cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={`${seg.dash} ${circumference - seg.dash}`} strokeDashoffset={-seg.offset}
            className={seg.className}
          />
        ))}
      </svg>
      {centerLabel && <div className="absolute inset-0 flex flex-col items-center justify-center">{centerLabel}</div>}
    </div>
  )
}
