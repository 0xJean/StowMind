import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DuplicatesScanCard } from '@/pages/duplicates/DuplicatesScanCard'
import { useI18n } from '@/i18n'
import { waitForPaint } from '@/pages/analyze/uiScheduler'
import { formatFileSize } from '@/lib/utils'
import { DuplicateGroup, useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { open as openPath } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { CheckSquare, ExternalLink, FileCheck2, Files, ScanSearch, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'

import type { DuplicateScanProgress } from './duplicates/types'

const INITIAL_VISIBLE_GROUPS = 25
const VISIBLE_GROUP_INCREMENT = 25

function splitPath(path: string) {
  const normalized = path.replace(/[\/]+$/, '') || path
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (slash < 0) return { name: normalized, directory: '' }
  return {
    name: normalized.slice(slash + 1) || normalized,
    directory: normalized.slice(0, slash) || normalized.slice(0, 1),
  }
}

export function DuplicatesPage() {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [progress, setProgress] = useState<DuplicateScanProgress | null>(null)
  const [scanElapsedMs, setScanElapsedMs] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const [lastScanEmpty, setLastScanEmpty] = useState(false)
  const [visibleGroupCount, setVisibleGroupCount] = useState(INITIAL_VISIBLE_GROUPS)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())

  const excludePatterns = useAppStore((s) => s.excludePatterns)

  const selectedSize = useMemo(() => {
    let total = 0
    for (const group of groups) {
      for (const path of group.paths) {
        if (selectedPaths.has(path)) total += group.size
      }
    }
    return total
  }, [groups, selectedPaths])

  useEffect(() => {
    const unlisten = listen<DuplicateScanProgress>('duplicate-scan-progress', (e) => {
      setProgress(e.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const selectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('duplicates.dialogTitle'),
    })
    if (selected && typeof selected === 'string') {
      setDirectory(selected)
      setScanError(null)
      setLastScanEmpty(false)
    }
  }

  const runScan = useCallback(async () => {
    if (!directory.trim()) {
      toast.info(t('duplicates.needDir'))
      return
    }
    const startedAt = Date.now()
    setScanning(true)
    setScanElapsedMs(0)
    setScanError(null)
    setLastScanEmpty(false)
    setProgress({ phase: 'collecting', current: 0, total: 0 })
    setGroups([])
    setVisibleGroupCount(INITIAL_VISIBLE_GROUPS)
    setSelectedPaths(new Set())
    await waitForPaint()
    try {
      const result = await invoke<DuplicateGroup[]>('find_duplicates_cmd', {
        directory: directory.trim(),
        recursive,
        excludePatterns: excludePatterns,
      })
      setVisibleGroupCount(INITIAL_VISIBLE_GROUPS)
      setGroups(result)
      setLastScanEmpty(result.length === 0)
      if (result.length === 0) {
        toast.success(t('duplicates.noneFound'))
      } else {
        toast.success(t('duplicates.foundGroups', { n: result.length }))
      }
    } catch (e) {
      const message = t('duplicates.failScan', { error: String(e) })
      console.error(e)
      setScanError(message)
      toast.error(message)
    } finally {
      setScanElapsedMs(Date.now() - startedAt)
      setScanning(false)
      setProgress(null)
    }
  }, [directory, recursive, excludePatterns, t])

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('duplicates.openFail')))
  }

  const togglePath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const selectDuplicateCopies = (group: DuplicateGroup) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      group.paths.slice(1).forEach((path) => next.add(path))
      return next
    })
  }

  const clearGroupSelection = (group: DuplicateGroup) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      group.paths.forEach((path) => next.delete(path))
      return next
    })
  }

  const selectAllDuplicateCopies = () => {
    setSelectedPaths(() => {
      const next = new Set<string>()
      groups.forEach((group) => group.paths.slice(1).forEach((path) => next.add(path)))
      return next
    })
  }

  const visibleGroups = groups.slice(0, visibleGroupCount)
  const hasMoreGroups = visibleGroupCount < groups.length

  const noResultsYet = groups.length === 0

  useEffect(() => {
    if (!scanning) return
    const interval = window.setInterval(() => {
      setScanElapsedMs((ms) => ms + 1000)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [scanning])

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col p-6 md:p-8">
      <div className="mb-6">
        <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('duplicates.title')}</h1>
      </div>

      {noResultsYet && (
        <div className="stow-clean-fullscreen -mx-6 -my-6 flex-1 md:-mx-8 md:-my-8">
          <DuplicatesScanCard
            directory={directory}
            errorMessage={scanError}
            elapsedMs={scanElapsedMs}
            emptyResult={lastScanEmpty}
            loading={scanning}
            progress={progress}
            recursive={recursive}
            onBrowse={() => void selectDirectory()}
            onDirectoryChange={(value) => {
              setDirectory(value)
              setScanError(null)
              setLastScanEmpty(false)
            }}
            onRecursiveChange={setRecursive}
            onScan={() => void runScan()}
          />
        </div>
      )}

      {groups.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>{t('duplicates.resultsTitle')}</CardTitle>
              <CardDescription>
                {t('duplicates.resultsDesc')}
                {selectedPaths.size > 0
                  ? ` ${t('duplicates.selectedSummary', {
                      n: selectedPaths.size,
                      size: formatFileSize(selectedSize),
                    })}`
                  : ''}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setGroups([])
                setSelectedPaths(new Set())
                setVisibleGroupCount(INITIAL_VISIBLE_GROUPS)
                setLastScanEmpty(false)
              }}
            >
              <ScanSearch className="mr-2 h-4 w-4" />
              {t('duplicates.scanAgain')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={selectAllDuplicateCopies}>
                <CheckSquare className="w-4 h-4 mr-2" />
                {t('duplicates.selectAllCopies')}
              </Button>
            </div>
            {visibleGroups.map((group, index) => (
              <DuplicateGroupComparison
                key={`${group.hash}-${index}`}
                group={group}
                selectedPaths={selectedPaths}
                onTogglePath={togglePath}
                onSelectCopies={selectDuplicateCopies}
                onClearSelection={clearGroupSelection}
                onReveal={reveal}
              />
            ))}
            {hasMoreGroups && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setVisibleGroupCount((count) => count + VISIBLE_GROUP_INCREMENT)}
              >
                {t('duplicates.showMoreGroups', { shown: visibleGroups.length, total: groups.length })}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}


function DuplicateGroupComparison({
  group,
  selectedPaths,
  onTogglePath,
  onSelectCopies,
  onClearSelection,
  onReveal,
}: {
  group: DuplicateGroup
  selectedPaths: Set<string>
  onTogglePath: (path: string) => void
  onSelectCopies: (group: DuplicateGroup) => void
  onClearSelection: (group: DuplicateGroup) => void
  onReveal: (path: string) => void
}) {
  const { t } = useI18n()
  const keepPath = group.paths[0]
  const duplicatePaths = group.paths.slice(1)
  const selectedCount = duplicatePaths.filter((path) => selectedPaths.has(path)).length

  return (
    <section className="stow-panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-iqon-border bg-iqon-row px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">{formatFileSize(group.size)}</Badge>
          <Badge>{t('duplicates.nCopies', { n: group.paths.length })}</Badge>
          <span className="max-w-full truncate font-mono text-[10px] text-muted-foreground">{group.hash}</span>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onSelectCopies(group)}>
            <CheckSquare className="mr-2 h-4 w-4" />
            {t('duplicates.selectCopies')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onClearSelection(group)}>
            <XCircle className="mr-2 h-4 w-4" />
            {t('duplicates.clearGroup')}
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div className="border-b border-iqon-border p-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold text-foreground">
            <FileCheck2 className="h-4 w-4 text-iqon-green" />
            {t('duplicates.keepColumn')}
          </div>
          <DuplicatePathRow
            path={keepPath}
            badge={t('duplicates.keep')}
            checked={false}
            selected={false}
            keep
            onReveal={onReveal}
          />
        </div>

        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground">
              <Files className="h-4 w-4 text-iqon-cyan" />
              {t('duplicates.copyColumn')}
            </div>
            <span className="rounded-full border border-iqon-border bg-iqon-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
              {t('duplicates.selectedInGroup', { n: selectedCount, total: duplicatePaths.length })}
            </span>
          </div>
          <div className="space-y-2">
            {duplicatePaths.map((path) => (
              <DuplicatePathRow
                key={path}
                path={path}
                badge={t('duplicates.copy')}
                checked={selectedPaths.has(path)}
                selected={selectedPaths.has(path)}
                onToggle={() => onTogglePath(path)}
                onReveal={onReveal}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function DuplicatePathRow({
  path,
  badge,
  checked,
  selected,
  keep,
  onToggle,
  onReveal,
}: {
  path: string
  badge: string
  checked: boolean
  selected: boolean
  keep?: boolean
  onToggle?: () => void
  onReveal: (path: string) => void
}) {
  const { t } = useI18n()
  const { name, directory } = splitPath(path)

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        selected ? 'border-iqon-cyan/60 bg-iqon-cyan/10' : 'border-iqon-border bg-iqon-card'
      }`}
    >
      {keep ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-iqon-green/15 text-iqon-green">
          <FileCheck2 className="h-3.5 w-3.5" />
        </span>
      ) : (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 accent-primary"
          aria-label={t('duplicates.selectPath')}
        />
      )}
      <div className="min-w-[220px] flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={keep ? 'success' : 'secondary'}>{badge}</Badge>
          <span className="min-w-0 truncate font-mono text-xs font-bold text-foreground" title={name}>
            {name}
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={path}>
          {directory || path}
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => onReveal(path)}>
        <ExternalLink className="mr-2 h-3.5 w-3.5" />
        {t('duplicates.reveal')}
      </Button>
    </div>
  )
}
