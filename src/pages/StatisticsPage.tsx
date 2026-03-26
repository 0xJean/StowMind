import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { formatDate, formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { BarChart3, CalendarDays, FileText, FolderOpen, HardDrive, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'

export function StatisticsPage() {
  const { t } = useI18n()
  const statistics = useAppStore((s) => s.statistics)
  const history = useAppStore((s) => s.history)
  const categories = useAppStore((s) => s.categories)

  const totalCategoryCount = Object.values(statistics.categoryCounts).reduce((a, b) => a + b, 0)

  const sortedCategories = useMemo(() => {
    return categories
      .map((cat) => ({
        ...cat,
        count: statistics.categoryCounts[cat.name] || 0,
      }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [categories, statistics.categoryCounts])

  const maxCategoryCount = sortedCategories.length > 0 ? sortedCategories[0].count : 0

  const recentDays = useMemo(() => {
    const days: { label: string; count: number; files: number }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const dayRecords = history.filter(
        (r) => r.timestamp.slice(0, 10) === dateStr && r.executed && !r.undone
      )
      days.push({
        label: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        count: dayRecords.length,
        files: dayRecords.reduce((sum, r) => sum + r.totalFiles, 0),
      })
    }
    return days
  }, [history])

  const maxDayFiles = Math.max(...recentDays.map((d) => d.files), 1)

  const undoneCount = history.filter((r) => r.undone).length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
        <p className="text-muted-foreground">{t('stats.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('stats.filesOrganized')}
            </CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.totalFilesOrganized}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('stats.totalSize')}
            </CardTitle>
            <HardDrive className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatFileSize(statistics.totalSizeOrganized)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('stats.organizeCount')}
            </CardTitle>
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {history.length}
              {undoneCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {t('stats.undoneCount', { n: undoneCount })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('stats.lastOrganized')}
            </CardTitle>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics.lastOrganized
                ? formatDate(statistics.lastOrganized).split(' ')[0]
                : '-'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            {t('stats.last7days')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2 h-40">
            {recentDays.map((day) => (
              <div key={day.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-muted-foreground">{day.files}</span>
                <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                  <div
                    className="w-full max-w-10 rounded-t bg-primary/80 transition-all duration-300"
                    style={{
                      height: `${Math.max((day.files / maxDayFiles) * 100, day.files > 0 ? 8 : 2)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{day.label}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-3 pt-3 border-t text-sm text-muted-foreground">
            <span>
              {t('stats.last7daysSummary')}{' '}
              <span className="font-medium text-foreground">
                {t('stats.nFiles', { n: recentDays.reduce((s, d) => s + d.files, 0) })}
              </span>
            </span>
            <span>
              <span className="font-medium text-foreground">
                {t('stats.nOps', { n: recentDays.reduce((s, d) => s + d.count, 0) })}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            {t('stats.categoryRank')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {totalCategoryCount === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t('stats.noData')}
            </p>
          ) : (
            <div className="space-y-3">
              {sortedCategories.map((cat) => {
                const percentage = totalCategoryCount > 0
                  ? (cat.count / totalCategoryCount) * 100
                  : 0
                const barWidth = maxCategoryCount > 0
                  ? (cat.count / maxCategoryCount) * 100
                  : 0

                return (
                  <div key={cat.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{cat.icon}</span>
                        <span className="font-medium">{cat.name}</span>
                      </div>
                      <span className="text-muted-foreground tabular-nums">
                        {t('stats.nItems', { n: cat.count })} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {totalCategoryCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('stats.allCategories')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categories.map((cat) => {
                const count = statistics.categoryCounts[cat.name] || 0
                const percentage = totalCategoryCount > 0
                  ? (count / totalCategoryCount) * 100
                  : 0

                return (
                  <div key={cat.name} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span>{cat.icon}</span>
                        <span>{cat.name}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {t('stats.nFilesPercent', { n: count })} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
