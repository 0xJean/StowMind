import { Button } from '@/components/ui/button'
import type { useI18n } from '@/i18n'
import { cn, formatFileSize } from '@/lib/utils'
import {
  ExternalLink,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Search,
  Square,
  Undo2,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import type { MoleAnalyzeEntry, MoleAnalyzeProgress, TreemapRect } from './types'

type Tone = 'cyan' | 'purple' | 'green' | 'yellow' | 'red'

const TREEMAP_TONES: Tone[] = ['cyan', 'purple', 'green', 'yellow', 'red']

const TONE_BG: Record<Tone, string> = {
  cyan: 'bg-iqon-cyan',
  purple: 'bg-iqon-purple',
  green: 'bg-iqon-green',
  yellow: 'bg-iqon-yellow',
  red: 'bg-iqon-red',
}

const TONE_TEXT: Record<Tone, string> = {
  cyan: 'text-iqon-cyan',
  purple: 'text-iqon-purple',
  green: 'text-iqon-green',
  yellow: 'text-iqon-yellow',
  red: 'text-iqon-red',
}

const TONE_GLOW: Record<Tone, string> = {
  cyan: 'shadow-[0_0_5px_hsl(var(--clean-cyan))]',
  purple: 'shadow-[0_0_5px_hsl(var(--clean-purple))]',
  green: 'shadow-[0_0_5px_hsl(var(--clean-green))]',
  yellow: 'shadow-[0_0_5px_hsl(var(--clean-yellow))]',
  red: 'shadow-[0_0_5px_hsl(var(--clean-red))]',
}

interface Props {
  t: ReturnType<typeof useI18n>['t']
  resultPath: string | null
  directory: string
  setDirectory: (value: string) => void
  analyzing: boolean
  progress: MoleAnalyzeProgress | null
  progressLog: MoleAnalyzeProgress[]
  cacheInfo: string | null
  cacheLoading: boolean
  visibleEntries: MoleAnalyzeEntry[]
  visibleTotal: number
  totalFiles: number
  focusedPath: string | null
  focusedLabel: string
  breadcrumbPaths: string[]
  rects: TreemapRect[]
  onAnalyzeSystem: () => void
  onAnalyzeCustom: () => void
  onAnalyzeExternalVolumes: () => void
  onCancelAnalyze: () => void
  onSelectDirectory: () => void
  onStepBack: () => void
  onRevealCurrent: () => void
  onBreadcrumb: (index: number, path: string) => void
  onDrillInto: (entry: MoleAnalyzeEntry) => void
  onEntryContextMenu: (event: MouseEvent, entry: MoleAnalyzeEntry) => void
}

export function AnalyzeSystemView({
  t,
  resultPath,
  directory,
  setDirectory,
  analyzing,
  progress,
  progressLog,
  cacheInfo,
  cacheLoading,
  visibleEntries,
  visibleTotal,
  totalFiles,
  focusedPath,
  focusedLabel,
  breadcrumbPaths,
  rects,
  onAnalyzeSystem,
  onAnalyzeCustom,
  onAnalyzeExternalVolumes,
  onCancelAnalyze,
  onSelectDirectory,
  onStepBack,
  onRevealCurrent,
  onBreadcrumb,
  onDrillInto,
  onEntryContextMenu,
}: Props) {
  const topEntry = visibleEntries[0]
  const topShare = topEntry && visibleTotal > 0 ? Math.round((topEntry.size / visibleTotal) * 100) : 0
  const scanned = Boolean(resultPath)
  const loadingFirstResult = cacheLoading && !scanned && !analyzing
  const progressLabel = progress
    ? progress.line ?? t(`analyze.progress.${progress.phase}` as Parameters<typeof t>[0])
    : null
  const progressCount = progress?.current && progress?.total
    ? t('analyze.progressCount', { current: progress.current, total: progress.total })
    : null

  return (
    <section className="space-y-4">
      <div className="iqon-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-iqon-row">
              <HardDrive className="h-5 w-5 text-iqon-cyan" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-foreground">{focusedLabel}</h3>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {resultPath ?? directory}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                <span className="font-mono tabular-nums text-foreground">{formatFileSize(visibleTotal)}</span>
                <span className="iqon-dot iqon-dot-muted" />
                <span>{t('analyze.resultsDesc', { files: totalFiles, size: formatFileSize(visibleTotal) })}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onAnalyzeSystem} disabled={analyzing}>
              {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              {t(scanned ? 'analyze.rescanSystem' : 'analyze.scanSystem')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onAnalyzeExternalVolumes} disabled={analyzing}>
              <HardDrive className="mr-2 h-4 w-4" />
              {t('analyze.externalVolumes')}
            </Button>
            {analyzing && (
              <Button type="button" variant="destructive" size="sm" onClick={onCancelAnalyze}>
                <Square className="mr-2 h-4 w-4" />
                {t('analyze.cancel')}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 gap-2">
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder={t('analyze.inputPlaceholder')}
              className="min-w-0 flex-1 rounded-xl border border-iqon-border bg-iqon-row px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-iqon-borderSoft"
            />
            <Button type="button" variant="outline" size="icon" onClick={onSelectDirectory} aria-label={t('analyze.browse')}>
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onAnalyzeCustom} disabled={analyzing || !directory.trim()}>
              {t('analyze.scanCustom')}
            </Button>
          </div>
          {cacheInfo && (
            <p className="font-mono text-[10px] text-muted-foreground">{cacheInfo}</p>
          )}
        </div>
      </div>

      {analyzing && progress && (
        <div className="iqon-card border-iqon-cyan/30 bg-iqon-cyan/5 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-foreground">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-iqon-cyan" />
                  {t('analyze.progressTitle')}
                </span>
                <span className="font-mono tabular-nums text-iqon-cyan">{progress.elapsedSecs}s</span>
                {progressCount && <span className="font-mono tabular-nums text-iqon-cyan">{progressCount}</span>}
              </div>
              {progressLabel && (
                <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">
                  {formatProgressLabel(progress, progressLabel)}
                </p>
              )}
            </div>
            {progressLog.length > 1 && (
              <div className="iqon-row max-h-24 min-w-0 flex-1 space-y-1 overflow-y-auto p-2 font-mono text-[10px] text-muted-foreground lg:max-w-xl">
                {progressLog.slice(-4).map((item, index) => (
                  <p key={`${item.elapsedSecs}-${item.phase}-${index}`} className="break-words">
                    {formatProgressLogLine(item, t)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="iqon-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {breadcrumbPaths.map((path, index) => {
                const isLast = index === breadcrumbPaths.length - 1
                return (
                  <button
                    key={`${path}-${index}`}
                    type="button"
                    className={cn(
                      'max-w-[16rem] truncate rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-colors',
                      isLast
                        ? 'border-iqon-cyan/30 bg-iqon-cyan/10 text-iqon-cyan'
                        : 'border-iqon-border bg-iqon-card text-muted-foreground hover:border-iqon-borderSoft hover:text-foreground'
                    )}
                    onClick={() => onBreadcrumb(index, path)}
                    title={path}
                  >
                    {index === 0 ? t('analyze.systemRoot') : path.split(/[\\/]/).filter(Boolean).pop() ?? path}
                  </button>
                )
              })}
            </div>
            <h2 className="mt-3 text-xl font-bold tracking-tight">{t('analyze.treemapTitle')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {topEntry ? t('analyze.topUsageHint', { name: topEntry.name, percent: topShare }) : t('analyze.emptyTreemap')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {focusedPath && (
              <Button type="button" variant="outline" size="sm" onClick={onStepBack}>
                <Undo2 className="mr-2 h-4 w-4" />
                {t('analyze.back')}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onRevealCurrent} disabled={!resultPath}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('analyze.revealCurrent')}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Left: treemap */}
          <div className="iqon-row relative h-[min(70vh,720px)] min-h-[32rem] overflow-hidden">
            {rects.map((rect, index) => {
              const percent = visibleTotal > 0 ? Math.round((rect.entry.size / visibleTotal) * 100) : 0
              const compact = rect.width < 12 || rect.height < 10
              const tone = TREEMAP_TONES[index % TREEMAP_TONES.length]
              return (
                <button
                  key={`${rect.entry.path}-${index}`}
                  type="button"
                  className={cn(
                    'absolute overflow-hidden rounded-md border border-background/40 p-3 text-left text-white transition-all hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring',
                    TONE_BG[tone],
                    'opacity-90 hover:opacity-100',
                    compact && 'p-0'
                  )}
                  style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
                  title={`${rect.entry.name} · ${formatFileSize(rect.entry.size)}`}
                  onClick={() => onDrillInto(rect.entry)}
                  onContextMenu={(event) => onEntryContextMenu(event, rect.entry)}
                >
                  {!compact && (
                    <span className="flex h-full flex-col items-center justify-center text-center">
                      <span className="flex items-center gap-2 text-sm font-bold">
                        <Folder className="h-4 w-4" />
                        {rect.entry.name}
                      </span>
                      <span className="mt-1 font-mono text-[10px] font-bold text-white/85">
                        {formatFileSize(rect.entry.size)} · {percent}%
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
            {rects.length === 0 && (
              <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
                <div className="max-w-md">
                  {(analyzing || loadingFirstResult) && <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-iqon-cyan" />}
                  <p className="text-sm font-bold text-foreground">
                    {analyzing ? t('analyze.analyzing') : loadingFirstResult ? t('analyze.loadingSavedResult') : t('analyze.emptyTreemap')}
                  </p>
                  {analyzing && progressLabel && (
                    <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground">
                      {formatProgressLabel(progress, progressLabel)}
                    </p>
                  )}
                  {analyzing && progressCount && (
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">{progressCount}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: top folders */}
          <div className="iqon-card flex min-h-0 flex-col p-4 2xl:max-h-[min(70vh,720px)]">
            <p className="iqon-eyebrow mb-3 shrink-0">{t('analyze.topFolders')}</p>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {visibleEntries.slice(0, 12).map((entry, index) => {
                const percent = visibleTotal > 0 ? Math.round((entry.size / visibleTotal) * 100) : 0
                const tone = TREEMAP_TONES[index % TREEMAP_TONES.length]
                const isFocused = focusedPath === entry.path
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={cn(
                      'iqon-row iqon-row-hover w-full p-3 text-left',
                      isFocused && 'border-iqon-cyan/40 bg-iqon-cyan/10'
                    )}
                    onClick={() => onDrillInto(entry)}
                    onContextMenu={(event) => onEntryContextMenu(event, entry)}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Folder className={cn('h-4 w-4 shrink-0', TONE_TEXT[tone])} />
                        <span className="truncate text-xs font-bold text-foreground">{entry.name}</span>
                      </div>
                      <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-foreground">
                        {formatFileSize(entry.size)}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-iqon-border">
                      <div
                        className={cn('h-full rounded-full transition-all', TONE_BG[tone], TONE_GLOW[tone])}
                        style={{ width: `${Math.max(2, percent)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-right font-mono text-[10px] text-muted-foreground">{percent}%</p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function formatProgressLabel(progress: MoleAnalyzeProgress | null, label: string) {
  if (!progress) return label
  return `${progress.stream ? `[${progress.stream}] ` : ''}${label}`
}

function formatProgressLogLine(
  progress: MoleAnalyzeProgress,
  t: ReturnType<typeof useI18n>['t']
) {
  const phase = t(`analyze.progress.${progress.phase}` as Parameters<typeof t>[0])
  const count = progress.current && progress.total ? `${progress.current}/${progress.total} ` : ''
  const stream = progress.stream ? `[${progress.stream}] ` : ''
  return `${progress.elapsedSecs}s ${count}${stream}${progress.line ?? phase}`
}
