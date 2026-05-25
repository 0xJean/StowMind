import type { MoleAnalyzeEntry, TreemapRect } from './types'

export function buildTreemap(entries: MoleAnalyzeEntry[], total: number): TreemapRect[] {
  const visible = entries.filter((entry) => entry.size > 0)
  const sorted = [...visible].sort((a, b) => b.size - a.size).slice(0, 28)
  if (sorted.length === 0 || total <= 0) return []
  return sliceTreemap(sorted, 0, 0, 100, 100, 0)
}

function sliceTreemap(entries: MoleAnalyzeEntry[], x: number, y: number, width: number, height: number, depth: number): TreemapRect[] {
  if (entries.length === 0 || width <= 0 || height <= 0) return []
  if (entries.length === 1 || depth >= 9) {
    return entries.map((entry) => ({ entry, x, y, width, height, depth }))
  }

  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  const half = total / 2
  let splitIndex = 0
  let running = 0
  for (let index = 0; index < entries.length - 1; index += 1) {
    const next = running + entries[index].size
    if (Math.abs(half - next) <= Math.abs(half - running)) {
      running = next
      splitIndex = index + 1
    } else {
      break
    }
  }

  const first = entries.slice(0, Math.max(1, splitIndex))
  const second = entries.slice(Math.max(1, splitIndex))
  const firstTotal = first.reduce((sum, entry) => sum + entry.size, 0)
  const ratio = total > 0 ? firstTotal / total : 0.5

  if (width >= height) {
    const firstWidth = width * ratio
    return [
      ...sliceTreemap(first, x, y, firstWidth, height, depth + 1),
      ...sliceTreemap(second, x + firstWidth, y, width - firstWidth, height, depth + 1),
    ]
  }

  const firstHeight = height * ratio
  return [
    ...sliceTreemap(first, x, y, width, firstHeight, depth + 1),
    ...sliceTreemap(second, x, y + firstHeight, width, height - firstHeight, depth + 1),
  ]
}
