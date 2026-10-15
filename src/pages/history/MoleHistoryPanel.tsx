import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/tauri'
import { Activity, History, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

interface MoleHistoryActions {
  removed?: number
  trashed?: number
  skipped?: number
  failed?: number
}

interface MoleHistorySession {
  command: string
  started_at: string
  ended_at: string
  items: number
  size: string
  operation_count: number
  failed_tasks: number
  actions: MoleHistoryActions
}

interface MoleHistoryDeletion {
  timestamp: string
  mode: string
  status: string
  size_kb: number
  path: string
}

interface MoleHistorySnapshot {
  sessions: MoleHistorySession[]
  deletions: MoleHistoryDeletion[]
}

function dateLabel(value: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function deletionSize(sizeKb: number) {
  return sizeKb > 0 ? formatFileSize(sizeKb * 1024) : '—'
}

export function MoleHistoryPanel() {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<MoleHistorySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await invoke<MoleHistorySnapshot>('mole_history_json', { limit: 8 })
      setSnapshot(next)
      setError(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sessions = snapshot?.sessions ?? []
  const deletions = snapshot?.deletions ?? []

  return (
    <section className="mb-8 rounded-2xl border border-iqon-border bg-iqon-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-xl bg-iqon-green/10 p-2 text-iqon-green">
            <History className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold">{t('history.mole.title')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('history.mole.desc')}</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          {t('history.mole.refresh')}
        </Button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-iqon-yellow/30 bg-iqon-yellow/10 p-3 text-xs text-muted-foreground">
          {t('history.mole.unavailable', { error })}
        </p>
      ) : sessions.length === 0 && deletions.length === 0 && !loading ? (
        <p className="mt-4 text-xs text-muted-foreground">{t('history.mole.empty')}</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              {t('history.mole.sessions')}
            </div>
            <div className="space-y-2">
              {sessions.slice(0, 4).map((session, index) => (
                <div key={`${session.started_at}-${session.command}-${index}`} className="rounded-xl border border-iqon-borderSoft bg-iqon-row px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{session.command || t('history.mole.unknownCommand')}</span>
                    <span className="text-muted-foreground">{dateLabel(session.started_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                    <span>{t('history.mole.items', { n: session.items })}</span>
                    <span>{session.size || '—'}</span>
                    <span>{t('history.mole.removed', { n: session.actions?.removed ?? 0 })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t('history.mole.deletions')}
            </div>
            <div className="space-y-2">
              {deletions.slice(0, 4).map((deletion, index) => (
                <div key={`${deletion.timestamp}-${deletion.path}-${index}`} className="rounded-xl border border-iqon-borderSoft bg-iqon-row px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-semibold" title={deletion.path}>{deletion.path || deletion.mode || '—'}</span>
                    <span className="shrink-0 text-muted-foreground">{deletion.status || '—'}</span>
                  </div>
                  <div className="mt-1 flex gap-3 text-muted-foreground">
                    <span>{dateLabel(deletion.timestamp)}</span>
                    <span>{deletionSize(deletion.size_kb)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
