import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { Download, Loader2, PackageSearch, RefreshCw, Trash2 } from 'lucide-react'
import type { MoleAppUpdateCapability } from './updateTypes'

interface Props {
  totalApps: number
  totalSize: number
  updateCandidates: number
  homebrewCount: number
  appCapability: MoleAppUpdateCapability | null
  loading: boolean
  updateLoading: boolean
  onRefresh: () => void
  onScanUpdates: () => void
}

export function ApplicationManagementStats({
  totalApps,
  totalSize,
  updateCandidates,
  homebrewCount,
  appCapability,
  loading,
  updateLoading,
  onRefresh,
  onScanUpdates,
}: Props) {
  const { t } = useI18n()

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5 border-b border-border/70 p-5 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{t('apps.badge.moleGui')}</Badge>
              <Badge variant="outline">{t('apps.badge.inventory')}</Badge>
              <Badge variant={appCapability?.cliExposed ? 'success' : 'warning'}>
                {appCapability?.cliExposed ? t('apps.updateNative') : t('apps.updateSupplement')}
              </Badge>
            </div>
            <div>
              <h2 className="text-xl font-bold">{t('apps.overviewTitle')}</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('apps.overviewDesc')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onRefresh} disabled={loading} variant="outline">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {t('apps.refresh')}
              </Button>
              <Button onClick={onScanUpdates} disabled={updateLoading} variant="secondary">
                {updateLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {t('apps.scanUpdates')}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border/70">
            <StatTile icon={PackageSearch} label={t('apps.metric.totalApps')} value={String(totalApps)} />
            <StatTile icon={Trash2} label={t('apps.metric.totalSize')} value={formatFileSize(totalSize)} />
            <StatTile icon={Download} label={t('apps.metric.updates')} value={String(updateCandidates)} />
            <StatTile icon={PackageSearch} label={t('apps.metric.homebrew')} value={String(homebrewCount)} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof PackageSearch
  label: string
  value: string
}) {
  return (
    <div className="min-h-[8rem] bg-card p-5">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-4 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}
