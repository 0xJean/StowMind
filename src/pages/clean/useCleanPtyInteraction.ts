import { useI18n } from '@/i18n'
import { invoke } from '@tauri-apps/api/tauri'
import { useState } from 'react'
import { toast } from 'react-toastify'

export type CleanInteractionKind = 'password' | 'confirm' | 'enter' | 'enter_space' | 'text' | string

export interface MoleCleanInteractionRequest {
  run_id: string
  prompt: string
  kind: CleanInteractionKind
}

export function useCleanPtyInteraction() {
  const { t } = useI18n()
  const [request, setRequest] = useState<MoleCleanInteractionRequest | null>(null)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const open = (next: MoleCleanInteractionRequest) => {
    setRequest(next)
    setValue('')
    setSubmitting(false)
  }

  const reset = () => {
    setRequest(null)
    setValue('')
    setSubmitting(false)
  }

  const submit = async (input?: string) => {
    if (!request) return
    setSubmitting(true)
    try {
      await invoke('mole_clean_preview_pty_submit_interaction', {
        runId: request.run_id,
        input: input ?? value,
      })
      reset()
    } catch (err) {
      toast.error(t('clean.interactionSubmitFail', { error: String(err) }))
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    const runId = request?.run_id
    reset()
    if (!runId) return
    try {
      await invoke('mole_clean_preview_pty_cancel', { runId })
    } catch (err) {
      toast.error(t('clean.interactionCancelFail', { error: String(err) }))
    }
  }

  return {
    request,
    value,
    submitting,
    setValue,
    open,
    reset,
    submit,
    cancel,
  }
}
