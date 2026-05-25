import type { LucideIcon } from 'lucide-react'
import { Activity, AlertTriangle, Archive, Bell, Download, Fingerprint, Monitor, PackageSearch, PackageX, Search, ShieldCheck, Terminal, Trash2, Zap } from 'lucide-react'

export type MoleCoverageState = 'visualized' | 'partial' | 'standalone' | 'missing'

export interface MoleCoverageItem {
  id: string
  titleKey: string
  descKey: string
  state: MoleCoverageState
  route?: string
  command?: string
  icon: LucideIcon
  noteKey?: string
  actionKey?: string
}

export const MOLE_COVERAGE: MoleCoverageItem[] = [
  {
    id: 'status',
    titleKey: 'status.title',
    descKey: 'status.subtitle',
    state: 'visualized',
    route: '/status',
    command: 'mo status -json',
    icon: Activity,
  },
  {
    id: 'analyze',
    titleKey: 'analyze.title',
    descKey: 'analyze.subtitle',
    state: 'visualized',
    route: '/analyze',
    command: 'mo analyze -json <path>',
    icon: Search,
  },
  {
    id: 'purge',
    titleKey: 'purge.title',
    descKey: 'purge.subtitle',
    state: 'visualized',
    route: '/purge',
    command: 'mo purge',
    icon: PackageX,
  },
  {
    id: 'installer',
    titleKey: 'installer.title',
    descKey: 'installer.subtitle',
    state: 'visualized',
    route: '/installers',
    command: 'mo installer',
    icon: Archive,
  },
  {
    id: 'clean',
    titleKey: 'clean.title',
    descKey: 'clean.subtitle',
    state: 'partial',
    route: '/clean',
    command: 'mo clean --dry-run',
    icon: Trash2,
    noteKey: 'moleMap.note.clean',
  },
  {
    id: 'optimize',
    titleKey: 'optimize.title',
    descKey: 'optimize.subtitle',
    state: 'partial',
    route: '/optimize',
    command: 'mo optimize --dry-run',
    icon: Zap,
    noteKey: 'moleMap.note.partial',
  },
  {
    id: 'uninstall',
    titleKey: 'uninstall.title',
    descKey: 'uninstall.subtitle',
    state: 'partial',
    route: '/apps',
    command: 'mo uninstall --list',
    icon: PackageX,
    noteKey: 'moleMap.note.partial',
  },
  {
    id: 'console',
    titleKey: 'deepclean.title',
    descKey: 'deepclean.subtitle',
    state: 'standalone',
    route: '/deepclean',
    command: 'mo',
    icon: Terminal,
    noteKey: 'moleMap.note.standalone',
  },
  {
    id: 'check',
    titleKey: 'moleMap.feature.check.title',
    descKey: 'moleMap.feature.check.desc',
    state: 'standalone',
    command: 'mo check',
    icon: ShieldCheck,
    noteKey: 'moleMap.note.standalone',
    actionKey: 'moleMap.feature.check.action',
  },
  {
    id: 'touchid',
    titleKey: 'moleMap.feature.touchid.title',
    descKey: 'moleMap.feature.touchid.desc',
    state: 'standalone',
    command: 'mo touchid',
    icon: Fingerprint,
    noteKey: 'moleMap.note.standalone',
    actionKey: 'moleMap.feature.touchid.action',
  },
  {
    id: 'completion',
    titleKey: 'moleMap.feature.completion.title',
    descKey: 'moleMap.feature.completion.desc',
    state: 'standalone',
    command: 'mo completion',
    icon: Terminal,
    noteKey: 'moleMap.note.standalone',
    actionKey: 'moleMap.feature.completion.action',
  },
  {
    id: 'update',
    titleKey: 'moleMap.feature.update.title',
    descKey: 'moleMap.feature.update.desc',
    state: 'standalone',
    command: 'mo update',
    icon: Download,
    noteKey: 'moleMap.note.standalone',
  },
  {
    id: 'softwareUpdate',
    titleKey: 'moleMap.feature.softwareUpdate.title',
    descKey: 'moleMap.feature.softwareUpdate.desc',
    state: 'partial',
    route: '/software-update',
    command: 'mo update',
    icon: Bell,
    noteKey: 'moleMap.note.partial',
  },
  {
    id: 'appUpdateScan',
    titleKey: 'moleMap.feature.appUpdateScan.title',
    descKey: 'moleMap.feature.appUpdateScan.desc',
    state: 'partial',
    route: '/software-update',
    icon: PackageSearch,
    noteKey: 'moleMap.note.appUpdateScan',
  },
  {
    id: 'doctor',
    titleKey: 'moleMap.feature.doctor.title',
    descKey: 'moleMap.feature.doctor.desc',
    state: 'visualized',
    route: '/doctor',
    command: 'mo',
    icon: AlertTriangle,
    noteKey: 'moleMap.note.doctor',
  },
  {
    id: 'remove',
    titleKey: 'moleMap.feature.remove.title',
    descKey: 'moleMap.feature.remove.desc',
    state: 'standalone',
    command: 'mo remove',
    icon: PackageX,
    noteKey: 'moleMap.note.standalone',
    actionKey: 'moleMap.feature.remove.action',
  },
  {
    id: 'hud',
    titleKey: 'moleMap.feature.hud.title',
    descKey: 'moleMap.feature.hud.desc',
    state: 'visualized',
    route: '/hud',
    command: 'mo status -json',
    icon: Monitor,
    noteKey: 'moleMap.note.hud',
  },
]

export const MOLE_COVERAGE_ORDER: MoleCoverageState[] = ['visualized', 'partial', 'standalone', 'missing']
