import { invoke } from '@tauri-apps/api/tauri'
import type { AIProvider } from '@/stores/app'

export type AiSetupIssue =
  | 'missingApiKey'
  | 'missingHost'
  | 'missingModel'
  | 'unavailable'
  | 'checkFailed'

export function aiProviderLabel(provider: AIProvider) {
  switch (provider.type) {
    case 'ollama':
      return 'Ollama'
    case 'openai':
      return 'OpenAI'
    case 'claude':
      return 'Claude API'
    case 'local_codex':
      return 'Codex CLI'
    case 'local_claude_code':
      return 'Claude Code'
  }
}

export function aiConfigurationIssue(provider: AIProvider): AiSetupIssue | null {
  if (!provider.model.trim() && provider.type !== 'local_codex' && provider.type !== 'local_claude_code') {
    return 'missingModel'
  }
  if (provider.type === 'ollama' && !provider.host?.trim()) {
    return 'missingHost'
  }
  if ((provider.type === 'openai' || provider.type === 'claude') && !provider.apiKey?.trim()) {
    return 'missingApiKey'
  }
  return null
}

export async function checkAiProvider(provider: AIProvider): Promise<AiSetupIssue | null> {
  const configurationIssue = aiConfigurationIssue(provider)
  if (configurationIssue) return configurationIssue

  try {
    const available = await invoke<boolean>('test_api_connection', { provider })
    return available ? null : 'unavailable'
  } catch {
    return 'checkFailed'
  }
}
