import { invoke } from '@tauri-apps/api/tauri'

export type MolePlatform = 'macos' | 'windows' | 'linux'

export interface MoleInstallationStatus {
  installed: boolean
  version: string | null
  platform: MolePlatform
}

export const MOLE_GITHUB = 'https://github.com/tw93/Mole'
export const MOLE_UPDATE_COMMAND = 'mo update'

export function buildMoleInstallCommand(platform: MolePlatform | string) {
  return platform === 'windows'
    ? 'powershell -Command "irm https://raw.githubusercontent.com/tw93/Mole/windows/install.ps1 | iex"'
    : 'bash -c "curl -fsSL https://raw.githubusercontent.com/tw93/mole/main/install.sh | bash"'
}

export async function checkMoleInstallation() {
  const status = await invoke<{ installed: boolean; version: string | null; platform: string }>('mole_check')
  return {
    installed: status.installed,
    version: status.version,
    platform: normalizeMolePlatform(status.platform),
  }
}

export function fallbackMoleStatus(platform: MolePlatform = 'linux'): MoleInstallationStatus {
  return {
    installed: false,
    version: null,
    platform,
  }
}

function normalizeMolePlatform(platform: string): MolePlatform {
  if (platform === 'macos' || platform === 'windows' || platform === 'linux') return platform
  return 'linux'
}
