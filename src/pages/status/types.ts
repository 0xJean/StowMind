export interface MoleHardware {
  model: string
  cpu_model: string
  total_ram: string
  disk_size: string
  os_version: string
}

export interface MoleCpu {
  usage: number
  load1: number
  load5: number
  load15: number
  core_count: number
  logical_cpu: number
}

export interface MoleMemory {
  used: number
  total: number
  used_percent: number
  swap_used: number
  swap_total: number
  cached: number
  pressure: string
}

export interface MoleDisk {
  mount: string
  device: string
  used: number
  total: number
  used_percent: number
  fstype: string
  external: boolean
}

export interface MoleDiskIo {
  read_rate: number
  write_rate: number
}

export interface MoleNetwork {
  name: string
  rx_rate_mbs: number
  tx_rate_mbs: number
  ip: string
}

export interface MoleBattery {
  percent: number
  status: string
  time_left: string
  health: string
  cycle_count: number
  capacity: number
}

export interface MoleProcess {
  pid: number
  name: string
  command: string
  cpu: number
  memory: number
}

export interface MoleStatusMetrics {
  collected_at: string
  host: string
  platform: string
  uptime: string
  procs: number
  hardware: MoleHardware
  health_score: number
  health_score_msg: string
  cpu: MoleCpu
  memory: MoleMemory
  disks: MoleDisk[]
  trash_size: number
  disk_io: MoleDiskIo
  network: MoleNetwork[]
  batteries: MoleBattery[]
  top_processes: MoleProcess[]
}

export type DiagnosticLevel = 'success' | 'warning' | 'destructive'

export type MetricVariant = 'default' | 'success' | 'warning' | 'destructive'

export interface DiagnosticItem {
  level: DiagnosticLevel
  title: string
  detail: string
}
