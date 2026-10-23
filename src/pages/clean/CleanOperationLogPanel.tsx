import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, SkipForward } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { parseCleanOperationLog } from './cleanExecutionResult'

type OperationRecord = ReturnType<typeof parseCleanOperationLog>[number]
const PAGE_SIZE = 40
const ACTION_LABELS = {
  REMOVED: 'clean.result.removed', TRASHED: 'clean.result.trashed',
  FAILED: 'clean.result.failed', SKIPPED: 'clean.result.skipped',
} as const

export function CleanOperationLogPanel({ records, status = 'available' }: {
  records: OperationRecord[]
  status?: 'available' | 'unavailable' | 'ambiguous'
}) {
  const { t } = useI18n()
  const groups = useMemo(() => ({
    failed: records.filter((record) => record.action === 'FAILED'),
    confirmed: records.filter((record) => record.action === 'REMOVED' || record.action === 'TRASHED'),
    skipped: records.filter((record) => record.action === 'SKIPPED'),
  }), [records])
  return (
    <Card>
      <CardHeader className="border-b border-border/70">
        <CardTitle>{t('clean.result.operationLogTitle')}</CardTitle>
        <CardDescription>{t('clean.result.logCountHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        {records.length === 0 && <p className="text-sm text-muted-foreground">{t(status === 'ambiguous' ? 'clean.result.logAmbiguous' : status === 'unavailable' ? 'clean.result.logUnavailable' : 'clean.result.noRecords')}</p>}
        {(['failed', 'confirmed', 'skipped'] as const).map((kind) => groups[kind].length > 0 && (
          <OperationGroup key={`${kind}-${records[0]?.runId ?? ''}`} kind={kind} records={groups[kind]} />
        ))}
      </CardContent>
    </Card>
  )
}

function OperationGroup({ kind, records }: { kind: 'failed' | 'confirmed' | 'skipped'; records: OperationRecord[] }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(kind === 'failed')
  const [page, setPage] = useState(0)
  const lastPage = Math.max(0, Math.ceil(records.length / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage)
  const offset = currentPage * PAGE_SIZE
  const visible = expanded ? records.slice(offset, offset + PAGE_SIZE) : []
  const Icon = kind === 'failed' ? AlertCircle : kind === 'skipped' ? SkipForward : CheckCircle2
  const tone = kind === 'failed' ? 'text-iqon-yellow' : kind === 'confirmed' ? 'text-iqon-green' : 'text-muted-foreground'
  return (
    <section className="rounded-xl border border-border/70 p-4">
      <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
        <span className="flex-1 text-sm font-bold">{t(`clean.result.${kind}Records`, { count: records.length })}</span>
        <span className="text-xs text-muted-foreground">{t(expanded ? 'clean.result.hideRecords' : 'clean.result.showRecords')}</span>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{t(`clean.result.${kind}Hint`)}</p>
      {expanded && (
        <>
          <ul className="mt-4 space-y-2">
            {visible.map((record, index) => (
              <li key={`${offset + index}-${record.action}`} className="flex items-start gap-3 rounded-lg bg-surface-hover/70 p-3">
                <span className={`shrink-0 text-[11px] font-semibold ${tone}`}>{t(ACTION_LABELS[record.action])}</span>
                <span className="min-w-0 break-all font-mono text-xs leading-relaxed">{record.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('clean.result.recordRange', { from: offset + 1, to: offset + visible.length, total: records.length })}</p>
            {lastPage > 0 && <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('clean.result.previous')}</Button>
              <Button type="button" variant="outline" size="sm" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{t('clean.result.next')}</Button>
            </div>}
          </div>
        </>
      )}
    </section>
  )
}
