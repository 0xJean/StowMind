// StowMind supplement uninstall insights.
//
// Mole provides the uninstall candidate list and owns actual removal. This file
// adds non-destructive UI hints for leftover classes, external volumes, vendor
// uninstallers, and personal-data risk while Mole has no detailed uninstall
// report JSON.

export const STOWMIND_SUPPLEMENT_UNINSTALL_SOURCE = 'stowmind_supplement'

export interface SupplementUninstallCandidate {
  name: string
  bundle_id: string
  source: string
  uninstall_name: string
  path: string
  size_bytes: number
}

export interface SupplementUninstallInsight {
  id: string
  level: 'info' | 'warning'
  titleKey: string
  detailKey: string
  detailVars?: Record<string, string | number>
}

export function buildUninstallInsights(
  item: SupplementUninstallCandidate | null | undefined
): SupplementUninstallInsight[] {
  if (!item) return []

  const insights: SupplementUninstallInsight[] = [
    {
      id: 'residue-classes',
      level: 'info',
      titleKey: 'uninstall.insight.residue.title',
      detailKey: 'uninstall.insight.residue.detail',
      detailVars: { name: item.name },
    },
    {
      id: 'personal-data',
      level: 'warning',
      titleKey: 'uninstall.insight.personal.title',
      detailKey: 'uninstall.insight.personal.detail',
      detailVars: { name: item.name },
    },
  ]

  if (isExternalVolume(item.path)) {
    insights.push({
      id: 'external-volume',
      level: 'warning',
      titleKey: 'uninstall.insight.external.title',
      detailKey: 'uninstall.insight.external.detail',
      detailVars: { path: item.path },
    })
  }

  if (hasVendorUninstallerHint(item)) {
    insights.push({
      id: 'vendor-uninstaller',
      level: 'info',
      titleKey: 'uninstall.insight.vendor.title',
      detailKey: 'uninstall.insight.vendor.detail',
      detailVars: { name: item.name },
    })
  }

  if (item.path.includes('/System/') || item.path.startsWith('/System/')) {
    insights.push({
      id: 'system-app',
      level: 'warning',
      titleKey: 'uninstall.insight.system.title',
      detailKey: 'uninstall.insight.system.detail',
    })
  }

  return insights
}

export function isExternalVolume(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.startsWith('/Volumes/') || /^[A-Za-z]:\//.test(normalized)
}

function hasVendorUninstallerHint(item: SupplementUninstallCandidate) {
  const haystack = `${item.name} ${item.bundle_id} ${item.path}`.toLowerCase()
  return [
    'adobe',
    'autodesk',
    'microsoft',
    'parallels',
    'vmware',
    'creative cloud',
    'docker',
  ].some((keyword) => haystack.includes(keyword))
}
