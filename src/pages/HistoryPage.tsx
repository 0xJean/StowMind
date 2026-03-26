import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { formatDate } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import { Calendar, FolderOpen, Loader2, Search, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'react-toastify'

type StatusFilter = 'all' | 'executed' | 'undone'

export function HistoryPage() {
  const { t } = useI18n()
  const history = useAppStore((s) => s.history)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const markUndone = useAppStore((s) => s.markUndone)
  const removeHistory = useAppStore((s) => s.removeHistory)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filtered = useMemo(() => {
    let list = history
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (r) =>
          r.directory.toLowerCase().includes(q) ||
          Object.keys(r.categories).some((c) => c.toLowerCase().includes(q))
      )
    }
    if (statusFilter === 'executed') {
      list = list.filter((r) => r.executed && !r.undone)
    } else if (statusFilter === 'undone') {
      list = list.filter((r) => r.undone)
    }
    return list
  }, [history, search, statusFilter])

  const handleUndo = async (id: string) => {
    const record = history.find((r) => r.id === id)
    if (!record || !record.moves?.length) {
      toast.warn(t('history.undoNoMoves'))
      return
    }
    if (record.undone) {
      toast.info(t('history.undoAlready'))
      return
    }

    const confirmed = window.confirm(t('history.undoConfirm', { n: record.moves.length }))
    if (!confirmed) return

    setUndoingId(id)
    try {
      const errors = await invoke<string[]>('undo_organize', {
        records: record.moves,
      })
      markUndone(id)
      if (errors.length > 0) {
        toast.warn(t('history.undoPartialFail', { n: errors.length }))
        console.warn('Undo errors:', errors)
      } else {
        toast.success(t('history.undoSuccess'))
      }
    } catch (error) {
      toast.error(t('history.undoFail', { error: String(error) }))
    } finally {
      setUndoingId(null)
    }
  }

  const statusButtons: { label: string; value: StatusFilter }[] = [
    { label: t('history.filterAll'), value: 'all' },
    { label: t('history.filterExecuted'), value: 'executed' },
    { label: t('history.filterUndone'), value: 'undone' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('history.title')}</h1>
          <p className="text-muted-foreground">{t('history.subtitle')}</p>
        </div>
        {history.length > 0 && (
          <Button variant="outline" onClick={clearHistory}>
            <Trash2 className="w-4 h-4 mr-2" />
            {t('history.clear')}
          </Button>
        )}
      </div>

      {history.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('history.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            {statusButtons.map((btn) => (
              <Button
                key={btn.value}
                variant={statusFilter === btn.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(btn.value)}
              >
                {btn.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Calendar className="w-12 h-12 mb-4 opacity-50" />
            <p>{t('history.empty')}</p>
            <p className="text-sm">{t('history.emptyHint')}</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search className="w-12 h-12 mb-4 opacity-50" />
            <p>{t('history.noMatch')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((record) => (
            <Card key={record.id} className={record.undone ? 'opacity-60' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-base font-medium">
                        {record.directory}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(record.timestamp)}
                      </p>
                    </div>
                  </div>
                  <Badge variant={record.undone ? 'secondary' : record.executed ? 'success' : 'warning'}>
                    {record.undone
                      ? t('history.statusUndone')
                      : record.executed
                        ? t('history.statusExecuted')
                        : t('history.statusPreview')}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">
                      {t('history.nFiles', { n: record.totalFiles })}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(record.categories).map(([cat, count]) => (
                        <Badge key={cat} variant="outline">
                          {cat}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {record.executed && !record.undone && record.moves?.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={undoingId === record.id}
                        onClick={() => handleUndo(record.id)}
                      >
                        {undoingId === record.id ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Undo2 className="w-4 h-4 mr-1" />
                        )}
                        {t('history.undo')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeHistory(record.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
