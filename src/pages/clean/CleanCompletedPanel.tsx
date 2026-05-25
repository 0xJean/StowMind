import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { Ban, CheckCircle2, Clock, Database, Files, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { CleanScanStatusPanel, formatElapsed } from './CleanScanStatusPanel'
import type { CleanCompletionStatus, MoleCleanPreview, MoleCleanSection } from './types'

interface CleanCompletedPanelProps {
  preview: MoleCleanPreview
  rawOutput: string
  outputLines: string[]
  completedAt: string
  elapsedMs: number
  status?: CleanCompletionStatus
  onRescan: () => void
}

export function CleanCompletedPanel({
  preview,
  rawOutput,
  outputLines,
  completedAt,
  elapsedMs,
  status = 'completed',
  onRescan,
}: CleanCompletedPanelProps) {
  const { t } = useI18n()
  const sections = useMemo(() => sortSectionsBySize(preview.sections), [preview.sections])
  const cancelled = status === 'cancelled'
  const displayedOutput = useMemo(() => {
    if (outputLines.length > 0) return outputLines
    const rawLines = rawOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    return rawLines.length > 0 ? rawLines : [t('clean.cleanStreamNoOutput')]
  }, [outputLines, rawOutput, t])

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('clean.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t(cancelled ? 'clean.cancelledSubtitle' : 'clean.completedSubtitle')}</p>
        </div>
      </div>

      <Card className={`overflow-hidden ${cancelled ? 'border-iqon-yellow/30' : 'border-iqon-green/30'}`}>
        <CardContent className="p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${cancelled ? 'bg-iqon-yellow/15 text-iqon-yellow' : 'bg-iqon-green/15 text-iqon-green'}`}>
                {cancelled ? <Ban className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
              </div>
              <div>
                <CardTitle className="text-3xl">{t(cancelled ? 'clean.cancelledTitle' : 'clean.completedTitle')}</CardTitle>
                <CardDescription className="mt-2 max-w-xl">
                  {t(cancelled ? 'clean.cancelledDesc' : 'clean.completedDesc', {
                    size: formatFileSize(preview.potential_space),
                    count: preview.item_count,
                  })}
                </CardDescription>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={onRescan}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('clean.completedRescan')}
            </Button>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-4">
            <ResultStat
              icon={<Database className="h-4 w-4" />}
              label={t(cancelled ? 'clean.cancelledSizeLabel' : 'clean.completedSizeLabel')}
              value={formatFileSize(preview.potential_space)}
            />
            <ResultStat
              icon={<Files className="h-4 w-4" />}
              label={t(cancelled ? 'clean.cancelledItemsLabel' : 'clean.completedItemsLabel')}
              value={String(preview.item_count)}
            />
            <ResultStat
              icon={<Files className="h-4 w-4" />}
              label={t('clean.completedCategoriesLabel')}
              value={String(preview.category_count)}
            />
            <ResultStat
              icon={<Clock className="h-4 w-4" />}
              label={t('clean.completedTimeLabel')}
              value={formatElapsed(elapsedMs)}
              hint={new Date(completedAt).toLocaleString()}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle>{t(cancelled ? 'clean.cancelledScopeTitle' : 'clean.completedScopeTitle')}</CardTitle>
          <CardDescription>{t(cancelled ? 'clean.cancelledScopeDesc' : 'clean.completedScopeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-6">
          {sections.length > 0 ? (
            sections.map((section, index) => (
              <CleanedSectionRow key={`${section.title}-${index}`} section={section} index={index} />
            ))
          ) : (
            <p className="rounded-2xl bg-surface-hover/80 p-4 text-sm text-muted-foreground">
              {t('clean.completedScopeEmpty')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle>{t('clean.completedOutputTitle')}</CardTitle>
          <CardDescription>{t(cancelled ? 'clean.cancelledOutputDesc' : 'clean.completedOutputDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <CleanScanStatusPanel
            loading={false}
            activity="clean"
            scanIdle={false}
            scanError={null}
            scanElapsedMs={elapsedMs}
            scanOutput={displayedOutput}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ResultStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="iqon-row p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="iqon-eyebrow">{label}</p>
      </div>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function CleanedSectionRow({ section, index }: { section: MoleCleanSection; index: number }) {
  const { t } = useI18n()
  const sectionSize = section.items.reduce((sum, item) => sum + itemSize(item), 0)
  const sectionCount = section.items.reduce((sum, item) => sum + (item.count ?? 0), 0)

  return (
    <div className="iqon-row flex items-center gap-4 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cleanTone(index)}`}>
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold">{section.title}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {section.items[0]?.label ?? t('clean.completedScopeEmpty')}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm font-bold tabular-nums text-foreground">
          {sectionSize > 0 ? formatFileSize(sectionSize) : t('clean.cleanableNoSize')}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('clean.itemCountShort', { count: sectionCount || section.items.length })}
        </p>
      </div>
    </div>
  )
}

function sortSectionsBySize(sections: MoleCleanSection[]) {
  return [...sections].sort((a, b) => sectionSize(b) - sectionSize(a))
}

function sectionSize(section: MoleCleanSection) {
  return section.items.reduce((sum, item) => sum + itemSize(item), 0)
}

function itemSize(item: { size?: number | null }) {
  return typeof item.size === 'number' && item.size > 0 ? item.size : 0
}

function cleanTone(index: number) {
  const tones = [
    'bg-clean-green/10 text-clean-green',
    'bg-primary/10 text-primary',
    'bg-clean-cyan/10 text-clean-cyan',
    'bg-clean-yellow/15 text-yellow-600 dark:text-clean-yellow',
    'bg-clean-red/10 text-clean-red',
  ]
  return tones[index % tones.length]
}
