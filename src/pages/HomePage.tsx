import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { BarChart3, Copy, FolderOpen, History, Settings, Sparkles, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function HomePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const statistics = useAppStore((s) => s.statistics)
  const history = useAppStore((s) => s.history)

  const quickActions = [
    { icon: FolderOpen, label: t('home.action.organize'), path: '/organize', color: 'text-blue-500' },
    { icon: History, label: t('home.action.history'), path: '/history', color: 'text-green-500' },
    { icon: BarChart3, label: t('home.action.stats'), path: '/statistics', color: 'text-purple-500' },
    { icon: Copy, label: t('home.action.duplicates'), path: '/duplicates', color: 'text-cyan-500' },
    { icon: Trash2, label: t('home.action.deepclean'), path: '/deepclean', color: 'text-red-500' },
    { icon: Settings, label: t('home.action.settings'), path: '/settings', color: 'text-orange-500' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">{t('home.welcome')}</h1>
          <p className="text-muted-foreground">{t('home.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('home.filesOrganized')}</CardDescription>
            <CardTitle className="text-3xl">{statistics.totalFilesOrganized}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('home.totalSize')}</CardDescription>
            <CardTitle className="text-3xl">{formatFileSize(statistics.totalSizeOrganized)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('home.organizeCount')}</CardDescription>
            <CardTitle className="text-3xl">{history.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('home.quickActions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickActions.map((action) => (
              <Button
                key={action.path}
                variant="outline"
                className="h-24 flex-col gap-2"
                onClick={() => navigate(action.path)}
              >
                <action.icon className={`w-8 h-8 ${action.color}`} />
                <span>{action.label}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('home.recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {history.slice(0, 5).map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="font-medium truncate max-w-md">{record.directory}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('home.nFiles', { n: record.totalFiles })} · {new Date(record.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-sm ${record.executed ? 'text-green-500' : 'text-yellow-500'}`}>
                    {record.executed ? t('home.executed') : t('home.previewOnly')}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
