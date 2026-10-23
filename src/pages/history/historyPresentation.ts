import type { HistoryRecordType } from '@/stores/app'
import { Archive, Bot, Copy, HardDrive, PackageSearch, PackageX, Smartphone, Sparkles, Trash2, Zap, type LucideIcon } from 'lucide-react'

export type TypeFilter = 'all' | HistoryRecordType
type HistoryTypeKey = `history.type.${HistoryRecordType}`

export const HISTORY_TYPE_KEYS: Record<HistoryRecordType, HistoryTypeKey> = {
  organize: 'history.type.organize',
  'ios-organize': 'history.type.ios-organize',
  duplicates: 'history.type.duplicates',
  clean: 'history.type.clean',
  purge: 'history.type.purge',
  installer: 'history.type.installer',
  uninstall: 'history.type.uninstall',
  optimize: 'history.type.optimize',
  'agent-cleanup': 'history.type.agent-cleanup',
  'system-cache': 'history.type.system-cache',
}

export const HISTORY_ICONS: Record<HistoryRecordType, LucideIcon> = {
  organize: Sparkles,
  'ios-organize': Smartphone,
  duplicates: Copy,
  clean: Trash2,
  purge: PackageX,
  installer: Archive,
  uninstall: PackageSearch,
  optimize: Zap,
  'agent-cleanup': Bot,
  'system-cache': HardDrive,
}

export const TYPE_FILTER_ORDER: TypeFilter[] = [
  'all',
  'organize',
  'ios-organize',
  'clean',
  'purge',
  'installer',
  'uninstall',
  'optimize',
  'duplicates',
  'agent-cleanup',
  'system-cache',
]
