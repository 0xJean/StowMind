import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Download, PackageSearch, Search, Trash2 } from 'lucide-react'
import type { AppManagementTab, SortMode } from './types'

interface SourceStat {
  value: string
  label: string
  count: number
}

interface Props {
  tab: AppManagementTab
  query: string
  source: string
  sortMode: SortMode
  sourceStats: SourceStat[]
  updateCount: number
  uninstallCount: number
  onTabChange: (tab: AppManagementTab) => void
  onQueryChange: (query: string) => void
  onSourceChange: (source: string) => void
  onSortModeChange: (mode: SortMode) => void
}

export function ApplicationFilters({
  tab,
  query,
  source,
  sortMode,
  sourceStats,
  updateCount,
  uninstallCount,
  onTabChange,
  onQueryChange,
  onSourceChange,
  onSortModeChange,
}: Props) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <TabButton active={tab === 'all'} icon={PackageSearch} label={t('apps.tab.all')} value={String(uninstallCount)} onClick={() => onTabChange('all')} />
        <TabButton active={tab === 'updates'} icon={Download} label={t('apps.tab.updates')} value={String(updateCount)} onClick={() => onTabChange('updates')} />
        <TabButton active={tab === 'uninstall'} icon={Trash2} label={t('apps.tab.uninstall')} value={t('apps.tab.moleReady')} onClick={() => onTabChange('uninstall')} />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('apps.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={sortMode} onValueChange={(value) => onSortModeChange(value as SortMode)}>
          <SelectTrigger className="w-full lg:w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="size_desc">{t('apps.sortSizeDesc')}</SelectItem>
            <SelectItem value="size_asc">{t('apps.sortSizeAsc')}</SelectItem>
            <SelectItem value="name">{t('apps.sortName')}</SelectItem>
            <SelectItem value="source">{t('apps.sortSource')}</SelectItem>
            <SelectItem value="update">{t('apps.sortUpdate')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sourceStats.map((stat) => (
          <Button
            key={stat.value}
            type="button"
            variant={source === stat.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onSourceChange(stat.value)}
            className="shrink-0"
          >
            {stat.label}
            <Badge variant={source === stat.value ? 'secondary' : 'outline'} className="ml-2">
              {stat.count}
            </Badge>
          </Button>
        ))}
      </div>
    </div>
  )
}

function TabButton({
  active,
  icon: Icon,
  label,
  value,
  onClick,
}: {
  active: boolean
  icon: typeof PackageSearch
  label: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[5rem] items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all',
        active ? 'border-primary/30 bg-primary/10 shadow-soft' : 'border-border/70 bg-card hover:bg-surface-hover'
      )}
    >
      <span className="flex items-center gap-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', active ? 'bg-primary text-primary-foreground' : 'bg-surface-hover text-muted-foreground')}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="font-bold">{label}</span>
      </span>
      <span className="text-sm font-semibold text-muted-foreground">{value}</span>
    </button>
  )
}
