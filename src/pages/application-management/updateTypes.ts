export interface MoleCapabilityProbe {
  command: string
  success: boolean
  outputExcerpt: string
}

export interface MoleAppUpdateCapability {
  platform: string
  moCommand: string
  moExecutable?: string | null
  cliExposed: boolean
  jsonExposed: boolean
  command?: string | null
  status: string
  message: string
  probes: MoleCapabilityProbe[]
}
