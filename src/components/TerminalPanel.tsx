import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { FitAddon } from '@xterm/addon-fit'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'

interface TerminalPanelProps {
  command: string
  onClose: () => void
}

interface PtyOutputEvent {
  id: number
  data: string // base64
}

interface PtyExitEvent {
  id: number
  code: number | null
}

interface TerminalOutputSnapshot {
  command: string
  output: string
  exitCode: number | null
}

const MAX_TERMINAL_CACHE_LENGTH = 24_000

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function splitCommand(command: string) {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of command.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  if (current) parts.push(current)
  return parts
}

export function TerminalPanel({ command }: TerminalPanelProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const outputRef = useRef('')
  const [spawning, setSpawning] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const spawnSession = async (term: Terminal) => {
    setSpawning(true)
    setError(null)

    const parts = splitCommand(command)
    const cmd = parts[0]
    const args = parts.slice(1)

    try {
      const id = await invoke<number>('pty_spawn', {
        command: cmd,
        args,
        cols: term.cols,
        rows: term.rows,
      })
      sessionIdRef.current = id
      setSpawning(false)
      // Focus terminal to capture keyboard input
      term.focus()
    } catch (err) {
      setError(String(err))
      setSpawning(false)
    }
  }

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        selectionForeground: '#ffffff',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#c9d1d9',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d364',
        brightWhite: '#f0f6fc',
      },
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Cascadia Code", "Fira Code", "Courier New", monospace',
      lineHeight: 1.2,
      scrollback: 5000,
      allowTransparency: false,
    })
    terminalRef.current = term

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    // Event listener unsubscribe functions
    const unlisteners: UnlistenFn[] = []

    // Set up event listeners and spawn session
    const setup = async () => {
      const snapshot = await loadResultSnapshot<TerminalOutputSnapshot>(resultCacheKeys.moleConsole(command))
      if (snapshot?.payload.output) {
        term.write(`\x1b[90m[${t('deepclean.cachedOutput')}]\x1b[0m\r\n`)
        term.write(snapshot.payload.output.slice(-MAX_TERMINAL_CACHE_LENGTH))
        term.write(`\r\n\x1b[90m[${t('deepclean.startingSession')}]\x1b[0m\r\n`)
      }

      // Listen for PTY output
      const unlistenOutput = await listen<PtyOutputEvent>('pty-output', (event) => {
        if (event.payload.id === sessionIdRef.current) {
          const bytes = base64ToUint8Array(event.payload.data)
          term.write(bytes)
          outputRef.current = `${outputRef.current}${new TextDecoder().decode(bytes)}`.slice(-MAX_TERMINAL_CACHE_LENGTH)
        }
      })
      unlisteners.push(unlistenOutput)

      // Listen for PTY exit
      const unlistenExit = await listen<PtyExitEvent>('pty-exit', (event) => {
        if (event.payload.id === sessionIdRef.current) {
          const code = event.payload.code
          const message = code != null
            ? t('deepclean.processExitedWithCode', { code })
            : t('deepclean.processExited')
          term.write(`\r\n\x1b[90m[${message}]\x1b[0m\r\n`)
          void saveResultSnapshot<TerminalOutputSnapshot>(resultCacheKeys.moleConsole(command), {
            command,
            output: outputRef.current,
            exitCode: code,
          })
        }
      })
      unlisteners.push(unlistenExit)

      // Forward keyboard input to PTY
      const onDataDisposable = term.onData((data) => {
        if (sessionIdRef.current != null) {
          invoke('pty_write', { id: sessionIdRef.current, data }).catch(() => {
            // Silently ignore write errors (session may have closed)
          })
        }
      })

      // Store disposable cleanup
      unlisteners.push(() => onDataDisposable.dispose())

      // Spawn the PTY session
      await spawnSession(term)
    }

    setup()

    // ResizeObserver for auto-fitting
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
        if (sessionIdRef.current != null) {
          invoke('pty_resize', {
            id: sessionIdRef.current,
            cols: terminalRef.current.cols,
            rows: terminalRef.current.rows,
          }).catch(() => {
            // Silently ignore resize errors
          })
        }
      }
    })
    resizeObserver.observe(containerRef.current)

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect()

      // Kill the PTY session
      if (sessionIdRef.current != null) {
        invoke('pty_kill', { id: sessionIdRef.current }).catch(() => {
          // Silently ignore kill errors
        })
      }

      // Unlisten all event listeners
      for (const unlisten of unlisteners) {
        unlisten()
      }

      // Dispose terminal
      term.dispose()
    }
  }, [command, t])

  const handleRetry = () => {
    if (terminalRef.current) {
      terminalRef.current.clear()
      spawnSession(terminalRef.current)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#0d1117] relative">
      {spawning && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1117]">
          <div className="flex items-center gap-2 text-[#8b949e]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="font-mono text-sm">{t('deepclean.startingTerminal')}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0d1117] gap-3">
          <p className="text-red-400 text-sm font-mono">{error}</p>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            {t('deepclean.retryTerminal')}
          </Button>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-1"
        onClick={() => terminalRef.current?.focus()}
      />
    </div>
  )
}
