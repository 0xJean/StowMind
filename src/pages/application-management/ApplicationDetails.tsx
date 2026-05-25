import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { type SupplementUninstallInsight } from '@/lib/stowmind-supplements/uninstallInsights'
import { formatFileSize } from '@/lib/utils'
import { ChevronDown, ChevronRight, Download, ExternalLink, Info, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ManagedAppRow, MoleUninstallOperationOutput } from './types'
import type { MoleAppUpdateCapability } from './updateTypes'

interface Props {
  row: ManagedAppRow | null
  insights: SupplementUninstallInsight[]
  preview: MoleUninstallOperationOutput | null
  previewing: boolean
  executing: boolean
  appCapability: MoleAppUpdateCapability | null
  onPreview: () => void
  onExecute: () => void
  onReveal: (path: string) => void
}

export function ApplicationDetails({
  row,
  insights,
  preview,
  previewing,
  executing,
  appCapability,
  onPreview,
  onExecute,
  onReveal,
}: Props) {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)

  useEffect(() => {
    setConfirming(false)
    setRawOpen(false)
  }, [row?.uninstall.path])

  if (!row) {
    return (
      <Card className="xl:sticky xl:top-6">
        <CardHeader>
          <CardTitle>{t('apps.detail.emptyTitle')}</CardTitle>
          <CardDescription>{t('apps.detail.emptyDesc')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const item = row.uninstall
  const updateStatus = row.update?.updateStatus ?? 'unknown'

  return (
    <div className="space-y-4 xl:sticky xl:top-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="break-words">{item.name}</CardTitle>
              <CardDescription className="mt-1 break-all">{item.path}</CardDescription>
            </div>
            <Button variant="ghost" size="icon" aria-label={t('apps.openPath')} onClick={() => onReveal(item.path)}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Fact label={t('apps.detail.size')} value={formatFileSize(item.size_bytes)} />
            <Fact label={t('apps.detail.source')} value={item.source} />
            <Fact label={t('apps.detail.uninstallName')} value={item.uninstall_name} />
            <Fact label={t('apps.detail.bundle')} value={item.bundle_id || 'unknown'} />
          </div>

          <div className="rounded-2xl border bg-surface-hover p-4">
            <div className="flex items-start gap-3">
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-semibold">{t('apps.updateTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.update
                    ? t(`apps.updateDetail.${updateStatus}` as Parameters<typeof t>[0])
                    : t('apps.updateDetail.unscanned')}
                </p>
                {row.update?.installedVersion && (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">{row.update.installedVersion}</p>
                )}
                <Badge variant={appCapability?.cliExposed ? 'success' : 'warning'} className="mt-3">
                  {appCapability?.cliExposed ? t('apps.updateNative') : t('apps.updateNoMoleAction')}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button type="button" variant="outline" className="w-full justify-start" onClick={onPreview} disabled={previewing || executing}>
              {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {previewing ? t('apps.previewing') : t('apps.previewUninstall')}
            </Button>
            <Button
              type="button"
              variant={confirming ? 'secondary' : 'destructive'}
              className="w-full justify-start"
              onClick={() => setConfirming(true)}
              disabled={previewing || executing}
            >
              {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {executing ? t('apps.uninstalling') : t('apps.uninstallWithMole')}
            </Button>
          </div>

          {confirming && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
              <p className="font-semibold text-destructive">{t('apps.confirmTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('apps.confirmDesc', { name: item.name })}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="destructive" onClick={onExecute} disabled={executing}>
                  {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  {t('apps.confirmRun')}
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={executing}>
                  {t('apps.confirmCancel')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('apps.insightsTitle')}</CardTitle>
          <CardDescription>{t('apps.insightsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <button type="button" className="flex w-full items-center justify-between gap-3 p-5 text-left" onClick={() => setRawOpen((value) => !value)}>
            <span className="font-semibold">{t('apps.previewOutput')}</span>
            {rawOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {rawOpen && (
            <CardContent className="pt-0">
              <pre className="max-h-96 overflow-auto rounded-2xl bg-surface-hover p-4 text-xs leading-relaxed whitespace-pre-wrap">
                {preview.raw_output}
              </pre>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-bold">{value}</p>
    </div>
  )
}

function InsightCard({ insight }: { insight: SupplementUninstallInsight }) {
  const { t } = useI18n()
  return (
    <div className="rounded-2xl border bg-surface-hover p-4">
      <div className="flex items-start gap-3">
        <Info className={`mt-0.5 h-4 w-4 shrink-0 ${insight.level === 'warning' ? 'text-yellow-500' : 'text-muted-foreground'}`} />
        <div className="min-w-0">
          <p className="font-medium">{t(insight.titleKey as Parameters<typeof t>[0])}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(insight.detailKey as Parameters<typeof t>[0], insight.detailVars)}
          </p>
        </div>
      </div>
    </div>
  )
}
