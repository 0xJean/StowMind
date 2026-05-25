import type { MoleBattery, MoleCpu, MoleDisk, MoleDiskIo, MoleHardware, MoleMemory, MoleNetwork, MoleProcess } from './types'

export interface MoleGpu {
  name: string
  usage: number
  memory_used: number
  memory_total: number
  core_count: number
  note?: string
}

export interface MoleThermal {
  cpu_temp: number
  gpu_temp: number
  battery_temp: number
  fan_speed: number
  fan_count: number
  system_power: number
  adapter_power: number
  battery_power: number
}

export interface MoleNetworkHistory {
  rx_history: number[]
  tx_history: number[]
}

export interface MoleProcessWatch {
  enabled: boolean
  cpu_threshold: number
  window: string
}

export interface MoleProcessAlert {
  title?: string
  detail?: string
  message?: string
  name?: string
  pid?: number
  cpu?: number
  memory?: number
  severity?: string
}

export interface MoleProxy {
  enabled: boolean
  type: string
  host: string
}

export interface MoleBluetoothDevice {
  name: string
  connected: boolean
  battery: string
}

export interface MoleStatusRaw {
  collected_at: string
  host: string
  platform: string
  uptime: string
  procs: number
  hardware: MoleHardware & { refresh_rate?: string | null }
  health_score: number
  health_score_msg: string
  cpu: MoleCpu & {
    per_core?: number[]
    per_core_estimated?: boolean
    p_core_count?: number
    e_core_count?: number
  }
  memory: MoleMemory
  disks: MoleDisk[]
  trash_size: number
  trash_approx?: boolean
  disk_io: MoleDiskIo
  network: MoleNetwork[]
  network_history?: MoleNetworkHistory
  batteries: MoleBattery[]
  top_processes: MoleProcess[]
  gpu?: MoleGpu[]
  thermal?: MoleThermal | null
  proxy?: MoleProxy | null
  bluetooth?: MoleBluetoothDevice[]
  process_watch?: MoleProcessWatch | null
  process_alerts?: MoleProcessAlert[]
  sensors?: unknown | null
}
