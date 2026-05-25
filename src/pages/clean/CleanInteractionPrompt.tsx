import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Check, CornerDownLeft, KeyRound, Keyboard, Loader2, X } from 'lucide-react'
import { FormEvent, useEffect, useRef } from 'react'
import type { CleanInteractionKind } from './useCleanPtyInteraction'

interface CleanInteractionPromptProps {
  open: boolean
  kind: CleanInteractionKind
  prompt: string
  value: string
  submitting: boolean
  onChange: (value: string) => void
  onSubmit: (input?: string) => void
  onCancel: () => void
}

export function CleanInteractionPrompt({
  open,
  kind,
  prompt,
  value,
  submitting,
  onChange,
  onSubmit,
  onCancel,
}: CleanInteractionPromptProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const needsInput = kind === 'password' || kind === 'text'

  useEffect(() => {
    if (!open || !needsInput) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open, needsInput])

  if (!open) return null

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }

  const Icon = kind === 'password' ? KeyRound : kind === 'enter' || kind === 'enter_space' ? CornerDownLeft : Keyboard

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md border-border/80 shadow-2xl">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">{interactionTitle(kind, t)}</CardTitle>
                <CardDescription className="mt-1">
                  {interactionDescription(kind, t)}
                </CardDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('clean.interactionCancel')}
              onClick={onCancel}
              disabled={submitting}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-xl bg-surface-hover px-3 py-2 font-mono text-xs text-muted-foreground">
            {prompt}
          </div>

          {kind === 'confirm' ? (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onSubmit('n')} disabled={submitting}>
                {t('clean.interactionNo')}
              </Button>
              <Button type="button" onClick={() => onSubmit('y')} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {t('clean.interactionYes')}
              </Button>
            </div>
          ) : kind === 'enter' || kind === 'enter_space' ? (
            <div className="flex justify-end gap-2">
              {kind === 'enter_space' ? (
                <Button type="button" variant="outline" onClick={() => onSubmit('__SPACE__')} disabled={submitting}>
                  {t('clean.interactionSkip')}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                  {t('clean.interactionCancel')}
                </Button>
              )}
              <Button type="button" onClick={() => onSubmit('__ENTER__')} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CornerDownLeft className="mr-2 h-4 w-4" />}
                {t('clean.interactionContinue')}
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Input
                ref={inputRef}
                type={kind === 'password' ? 'password' : 'text'}
                value={value}
                autoComplete={kind === 'password' ? 'current-password' : 'off'}
                placeholder={kind === 'password' ? t('clean.passwordPlaceholder') : t('clean.interactionInputPlaceholder')}
                onChange={(event) => onChange(event.target.value)}
                disabled={submitting}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                  {t('clean.interactionCancel')}
                </Button>
                <Button type="submit" disabled={submitting || value.length === 0}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
                  {t('clean.interactionSubmit')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function interactionTitle(kind: CleanInteractionKind, t: ReturnType<typeof useI18n>['t']) {
  if (kind === 'password') return t('clean.passwordPromptTitle')
  if (kind === 'confirm') return t('clean.interactionConfirmTitle')
  if (kind === 'enter' || kind === 'enter_space') return t('clean.interactionEnterTitle')
  return t('clean.interactionInputTitle')
}

function interactionDescription(kind: CleanInteractionKind, t: ReturnType<typeof useI18n>['t']) {
  if (kind === 'password') return t('clean.passwordPromptDesc')
  if (kind === 'confirm') return t('clean.interactionConfirmDesc')
  if (kind === 'enter_space') return t('clean.interactionEnterSpaceDesc')
  if (kind === 'enter') return t('clean.interactionEnterDesc')
  return t('clean.interactionInputDesc')
}
