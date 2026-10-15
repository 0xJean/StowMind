import { Loader2, StopCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'

export function IosScanActivity({ onCancel }: { onCancel: () => void | Promise<unknown> }) {
  const { t } = useI18n()
  const [seconds, setSeconds] = useState(0)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const stop = async () => {
    setStopping(true)
    setError(null)
    try {
      if (await onCancel() === false) setStopping(false)
    } catch (cause) {
      setError(String(cause))
      setStopping(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3" role="status">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-iqon-green motion-reduce:animate-none" />
        <div>
          <p className="text-sm font-bold">{t(stopping ? 'iosOrganize.scan.stopping' : 'iosOrganize.scan.inProgress')}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('iosOrganize.scan.waitHelp')}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('iosOrganize.scan.elapsed', { seconds })}</p>
      {error && <p className="text-xs text-amber-200" role="alert">{error}</p>}
      <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void stop()} disabled={stopping}>
        <StopCircle className="h-4 w-4" />
        {t(stopping ? 'iosOrganize.scan.stopping' : 'iosOrganize.scan.stop')}
      </button>
      <p className="text-xs text-muted-foreground">{t('iosOrganize.scan.emergencyStop')}</p>
    </div>
  )
}
