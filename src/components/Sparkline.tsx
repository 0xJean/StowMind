import { cn } from '@/lib/utils'

export function Sparkline({
  values,
  className,
  colorClassName = 'stroke-primary',
}: {
  values: number[]
  className?: string
  colorClassName?: string
}) {
  const safe = values.length > 0 ? values : [0]
  const width = 160
  const height = 48
  const max = Math.max(...safe, 1)
  const min = Math.min(...safe, 0)
  const span = max - min || 1
  const points = safe
    .map((value, index) => {
      const x = safe.length === 1 ? width / 2 : (index / (safe.length - 1)) * width
      const y = height - ((value - min) / span) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-12 w-full overflow-visible', className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        className={cn('fill-none stroke-2', colorClassName)}
        points={points}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
