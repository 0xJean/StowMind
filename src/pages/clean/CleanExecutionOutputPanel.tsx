import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { useMemo, useState } from 'react'

const MAX_LINES = 600
const MAX_CHARACTERS = 80_000

function boundOutput(output: string) {
  const lines = output.split(/\r?\n/)
  if (lines.length <= MAX_LINES && output.length <= MAX_CHARACTERS) return { text: output, truncated: false, count: lines.length }
  const first = lines.slice(0, MAX_LINES / 2).join('\n').slice(0, MAX_CHARACTERS / 2)
  const last = lines.slice(-MAX_LINES / 2).join('\n').slice(-MAX_CHARACTERS / 2)
  return { text: `${first}\n…\n${last}`, truncated: true, count: first.split('\n').length + last.split('\n').length }
}

/** Keep stdout summaries and diagnostics readable without appending the operation ledger. */
export function CleanExecutionOutputPanel({ output }: { output: string }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(true)
  const bounded = useMemo(() => boundOutput(output.trim()), [output])
  return (
    <Card>
      <CardHeader className="border-b border-border/70">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t('clean.result.stdoutTitle')}</CardTitle>
          <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {t(expanded ? 'clean.result.hideOutput' : 'clean.result.showOutput')}
          </Button>
        </div>
        <CardDescription>{t('clean.result.stdoutDesc')}</CardDescription>
      </CardHeader>
      {expanded && <CardContent className="p-6">
        {bounded.truncated && <p className="mb-3 text-xs text-iqon-yellow">{t('clean.result.outputTruncated', { count: bounded.count })}</p>}
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border/70 bg-background/60 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {bounded.text || t('clean.cleanStreamNoOutput')}
        </pre>
      </CardContent>}
    </Card>
  )
}
