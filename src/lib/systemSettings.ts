import { invoke } from '@tauri-apps/api/tauri'

export type SystemSettingsTarget = 'login_items' | 'full_disk_access'

export interface NativeSystemSettingsState {
  platform: string
  launchAtLoginSupported: boolean
  launchAtLoginEnabled: boolean
  fullDiskAccessStatus: 'granted' | 'denied' | 'unknown' | 'unsupported' | string
}

export async function getSystemSettingsState() {
  return invoke<NativeSystemSettingsState>('system_settings_state')
}

export async function openSystemSettingsTarget(target: SystemSettingsTarget) {
  return invoke('open_system_settings', { target })
}

export function shouldPromptFullDiskAccess(state: NativeSystemSettingsState | null) {
  return Boolean(
    state &&
      state.platform === 'macos' &&
      state.fullDiskAccessStatus !== 'granted' &&
      state.fullDiskAccessStatus !== 'unsupported'
  )
}
