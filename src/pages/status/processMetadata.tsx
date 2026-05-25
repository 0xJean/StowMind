import {
  Bot,
  Braces,
  Box,
  Chrome,
  Code2,
  Database,
  GitBranch,
  Hammer,
  Monitor,
  RadioTower,
  Server,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import type { MoleProcess } from './types'

export interface ProcessMetadata {
  icon: LucideIcon
  labelKey: string
}

const PROCESS_PATTERNS: Array<{ patterns: string[]; icon: LucideIcon; labelKey: string }> = [
  { patterns: ['chrome', 'chromium', 'safari', 'firefox', 'edge', 'arc'], icon: Chrome, labelKey: 'status.process.kind.browser' },
  { patterns: ['node', 'npm', 'pnpm', 'vite', 'webpack', 'bun', 'deno'], icon: Braces, labelKey: 'status.process.kind.javascript' },
  { patterns: ['code', 'cursor', 'xcode', 'idea', 'webstorm', 'zed'], icon: Code2, labelKey: 'status.process.kind.ide' },
  { patterns: ['postgres', 'mysql', 'redis', 'sqlite', 'mongo'], icon: Database, labelKey: 'status.process.kind.database' },
  { patterns: ['docker', 'colima', 'podman', 'containerd'], icon: Box, labelKey: 'status.process.kind.container' },
  { patterns: ['git', 'gh'], icon: GitBranch, labelKey: 'status.process.kind.git' },
  { patterns: ['ollama', 'claude', 'openai', 'llama', 'python'], icon: Bot, labelKey: 'status.process.kind.ai' },
  { patterns: ['bash', 'zsh', 'fish', 'sh', 'terminal', 'iterm'], icon: Terminal, labelKey: 'status.process.kind.terminal' },
  { patterns: ['launchd', 'kernel', 'windowserver', 'system', 'sysmond'], icon: Monitor, labelKey: 'status.process.kind.system' },
  { patterns: ['brew', 'softwareupdate', 'update'], icon: Hammer, labelKey: 'status.process.kind.maintenance' },
  { patterns: ['vpn', 'proxy', 'clash', 'surge', 'tailscale'], icon: RadioTower, labelKey: 'status.process.kind.network' },
]

export function processMetadata(process: MoleProcess): ProcessMetadata {
  const haystack = `${process.name} ${process.command}`.toLowerCase()
  const match = PROCESS_PATTERNS.find((item) => item.patterns.some((pattern) => haystack.includes(pattern)))
  return match ?? { icon: Server, labelKey: 'status.process.kind.other' }
}
