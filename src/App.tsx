import { invoke } from '@tauri-apps/api/tauri'
import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { OrganizePage } from './pages/OrganizePage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { useAppStore } from './stores/app'

function App() {
  const setOllamaOnline = useAppStore((s) => s.setOllamaOnline)
  const aiProvider = useAppStore((s) => s.aiProvider)

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
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
