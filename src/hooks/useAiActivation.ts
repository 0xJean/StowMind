import { useCallback, useEffect, useRef, useState } from 'react'
import { checkAiProvider, type AiSetupIssue } from '@/lib/aiProvider'
import type { AIProvider } from '@/stores/app'

export type AiActivationStatus = 'off' | 'checking' | 'ready' | 'needs-setup'

export function useAiActivation(provider: AIProvider) {
  const [enabled, setEnabledState] = useState(false)
  const [status, setStatus] = useState<AiActivationStatus>('off')
  const [issue, setIssue] = useState<AiSetupIssue | null>(null)
  const requestId = useRef(0)

  const setEnabled = useCallback(async (next: boolean) => {
    const currentRequest = ++requestId.current
    if (!next) {
      setEnabledState(false)
      setStatus('off')
      setIssue(null)
      return false
    }

    setEnabledState(false)
    setStatus('checking')
    setIssue(null)
    const nextIssue = await checkAiProvider(provider)
    if (currentRequest !== requestId.current) return false

    if (nextIssue) {
      setStatus('needs-setup')
      setIssue(nextIssue)
      return false
    }

    setEnabledState(true)
    setStatus('ready')
    return true
  }, [provider])

  useEffect(() => {
    requestId.current += 1
    setEnabledState(false)
    setStatus('off')
    setIssue(null)
  }, [provider])

  return {
    enabled,
    status,
    issue,
    setEnabled,
  }
}
