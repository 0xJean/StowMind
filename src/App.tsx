import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { toast } from 'react-toastify'
import { Sidebar } from './components/Sidebar'
import { useI18n } from './i18n'
import { DeepCleanPage } from './pages/DeepCleanPage'
import { DuplicatesPage } from './pages/DuplicatesPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { OrganizePage } from './pages/OrganizePage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { useAppStore } from './stores/app'

interface WatchFolderChangePayload {
  paths: string[]
  kind: string
}

function App() {
  const { t } = useI18n()
  const setOllamaOnline = useAppStore((s) => s.setOllamaOnline)
  const aiProvider = useAppStore((s) => s.aiProvider)
  const watchFolderEnabled = useAppStore((s) => s.watchFolderEnabled)
  const watchFolderPathsText = useAppStore((s) => s.watchFolderPathsText)

  useEffect(() => {
    const unlisten = listen<WatchFolderChangePayload>('watch-folder-change', (event) => {
      const sample = event.payload.paths[0] ?? ''
      toast.info(
        t('watch.notify', {
          kind: event.payload.kind,
          path: sample.length > 80 ? `${sample.slice(0, 80)}…` : sample,
        })
      )
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [t])

  useEffect(() => {
    if (!watchFolderEnabled) {
      invoke('watch_set_paths', { paths: [] }).catch(() => {})
      return
    }
    const timer = window.setTimeout(() => {
      const paths = watchFolderPathsText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      invoke('watch_set_paths', { paths }).catch(() => {})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [watchFolderEnabled, watchFolderPathsText])

  useEffect(() => {
    const checkOllama = async () => {
      if (aiProvider.type === 'ollama') {
        try {
          const online = await invoke<boolean>('check_ollama', { 
            host: aiProvider.host 
          })
          setOllamaOnline(online)
        } catch {
          setOllamaOnline(false)
        }
      }
    }

    checkOllama()
    const interval = setInterval(checkOllama, 10000)
    return () => clearInterval(interval)
  }, [aiProvider, setOllamaOnline])

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/organize" element={<OrganizePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/duplicates" element={<DuplicatesPage />} />
          <Route path="/deepclean" element={<DeepCleanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
