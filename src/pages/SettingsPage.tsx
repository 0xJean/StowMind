import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTheme, type Theme } from '@/hooks/useTheme'
import { useI18n, type Locale } from '@/i18n'
import { parseCategoriesImport, serializeCategories } from '@/lib/categoryRules'
import { defaultCategories, useAppStore, type AIProvider, type Category } from '@/stores/app'
import { open, save } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { readTextFile, writeTextFile } from '@tauri-apps/api/fs'
import { invoke } from '@tauri-apps/api/tauri'
import { Archive, Bot, Eye, Globe, Loader2, Moon, RefreshCw, Save, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import { CategoryRulesSection } from './settings/CategoryRulesSection'
import { MoleSystemSettingsSection } from './settings/MoleSystemSettingsSection'

interface AiStreamEvent {
  provider: string
  status: 'started' | 'chunk' | 'completed' | 'error'
  chunk?: string
  message?: string
}

interface AiTestResult {
  ok: boolean
  detail: string
}

function isLocalCliProvider(type: AIProvider['type']) {
  return type === 'local_codex' || type === 'local_claude_code'
}

export function SettingsPage() {
  const location = useLocation()
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()

  const aiProvider = useAppStore((s) => s.aiProvider)
  const setAIProvider = useAppStore((s) => s.setAIProvider)
  const aiOnlyHardCases = useAppStore((s) => s.aiOnlyHardCases)
  const setAIOnlyHardCases = useAppStore((s) => s.setAIOnlyHardCases)
  const excludePatterns = useAppStore((s) => s.excludePatterns)
  const setExcludePatterns = useAppStore((s) => s.setExcludePatterns)
  const backupBeforeOrganize = useAppStore((s) => s.backupBeforeOrganize)
  const setBackupBeforeOrganize = useAppStore((s) => s.setBackupBeforeOrganize)
  const backupDirectory = useAppStore((s) => s.backupDirectory)
  const setBackupDirectory = useAppStore((s) => s.setBackupDirectory)
  const watchFolderEnabled = useAppStore((s) => s.watchFolderEnabled)
  const setWatchFolderEnabled = useAppStore((s) => s.setWatchFolderEnabled)
  const watchFolderPathsText = useAppStore((s) => s.watchFolderPathsText)
  const setWatchFolderPathsText = useAppStore((s) => s.setWatchFolderPathsText)
  const categories = useAppStore((s) => s.categories)
  const setCategories = useAppStore((s) => s.setCategories)
  const setOllamaOnline = useAppStore((s) => s.setOllamaOnline)

  const [excludeDraft, setExcludeDraft] = useState(() => excludePatterns.join('\n'))
  useEffect(() => {
    setExcludeDraft(excludePatterns.join('\n'))
  }, [location.pathname, excludePatterns])

  useEffect(() => {
    if (location.hash !== '#ai-settings') return
    const timer = window.setTimeout(() => {
      document.getElementById('ai-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [location.hash])

  const [localProvider, setLocalProvider] = useState<AIProvider>(aiProvider)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [streamText, setStreamText] = useState('')
  const [streamMessage, setStreamMessage] = useState('')
  useEffect(() => {
    setLocalProvider(aiProvider)
  }, [aiProvider])

  useEffect(() => {
    const unlisten = listen<AiStreamEvent>('ai-stream', (event) => {
      const data = event.payload
      if (data.provider !== localProvider.type) return
      if (data.status === 'started') {
        setStreamText('')
        setStreamMessage(data.message || '')
        return
      }
      if (data.status === 'chunk' && data.chunk) {
        setStreamText((current) => `${current}${data.chunk}`.slice(-12000))
        return
      }
      if (data.status === 'completed' || data.status === 'error') {
        setStreamMessage(data.message || '')
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [localProvider.type])

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const handleProviderChange = (type: AIProvider['type']) => {
    const defaults: Record<AIProvider['type'], Partial<AIProvider>> = {
      ollama: { host: 'http://localhost:11434', model: 'qwen3:4b' },
      openai: { model: 'gpt-4o-mini' },
      claude: { model: 'claude-3-haiku-20240307' },
      local_codex: { executable: 'codex', model: '' },
      local_claude_code: { executable: 'claude', model: '' },
    }
    setStreamText('')
    setStreamMessage('')
    setTestResult(null)
    setLocalProvider({ ...localProvider, type, ...defaults[type] })
  }

  const saveProvider = () => setAIProvider(localProvider)

  const pickBackupDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('settings.organizeBackupDialogTitle'),
    })
    if (selected && typeof selected === 'string') {
      setBackupDirectory(selected)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setStreamText('')
    setStreamMessage('')
    try {
      const result = await invoke<AiTestResult>('ai_test_provider', { provider: localProvider })
      setTestResult(result.ok ? 'success' : 'error')
      setStreamMessage(result.detail)
      if (localProvider.type === 'ollama') setOllamaOnline(result.ok)
    } catch {
      setTestResult('error')
      setStreamMessage(t('settings.aiStreamFailed'))
    } finally {
      setTesting(false)
    }
  }

  const addCategory = () => {
    const newCats = [...categories, { name: t('settings.newCategory'), icon: '📁', extensions: [], keywords: [] }]
    setCategories(newCats)
    setExpandedIdx(newCats.length - 1)
  }

  const updateCategory = (index: number, updates: Partial<Category>) => {
    const next = [...categories]
    next[index] = { ...next[index], ...updates }
    setCategories(next)
  }

  const removeCategory = (index: number) => {
    setCategories(categories.filter((_, i) => i !== index))
    if (expandedIdx === index) setExpandedIdx(null)
  }

  const moveCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= categories.length) return
    const next = [...categories]
    ;[next[index], next[target]] = [next[target], next[index]]
    setCategories(next)
    setExpandedIdx(target)
  }

  const resetCategories = () => {
    if (window.confirm(t('settings.resetConfirm'))) {
      setCategories(defaultCategories)
      setExpandedIdx(null)
    }
  }

  const exportCategoryRules = async () => {
    try {
      const path = await save({
        defaultPath: 'stowmind-categories.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: t('settings.rulesExportDialogTitle'),
      })
      if (path == null || typeof path !== 'string') return
      await writeTextFile(path, serializeCategories(categories))
      toast.success(t('settings.rulesExportSuccess'))
    } catch (e) {
      toast.error(t('settings.rulesExportFail', { error: String(e) }))
    }
  }

  const importCategoryRules = async () => {
    try {
      const path = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
        title: t('settings.rulesImportDialogTitle'),
      })
      if (path == null || typeof path !== 'string') return
      const text = await readTextFile(path)
      const next = parseCategoriesImport(text)
      if (!window.confirm(t('settings.rulesImportConfirm', { n: next.length }))) return
      setCategories(next)
      setExpandedIdx(null)
      toast.success(t('settings.rulesImportSuccess', { n: next.length }))
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'json') toast.error(t('settings.rulesImportInvalidJson'))
        else if (e.message === 'shape' || e.message === 'empty' || e.message === 'none') toast.error(t('settings.rulesImportInvalidShape'))
        else toast.error(t('settings.rulesImportFail', { error: e.message }))
      } else {
        toast.error(t('settings.rulesImportFail', { error: String(e) }))
      }
    }
  }

  return (
    <div className="stow-page">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.system')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
      </div>

      <SettingsCard title="StowMind" description={t('settings.brandSubtitle')}>
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="StowMind" className="h-10 w-10 rounded-2xl" draggable={false} />
          <div className="text-sm text-muted-foreground">{t('settings.brandSubtitle')}</div>
        </div>
      </SettingsCard>

      <SettingsCard icon={<Globe className="h-4 w-4" />} title={t('settings.language')} description={t('settings.languageDesc')}>
        <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh">中文</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </SettingsCard>

      <SettingsCard title={t('settings.scanExclude')} description={t('settings.scanExcludeDesc')}>
        <textarea
          className="flex min-h-[120px] w-full rounded-2xl border border-input bg-iqon-row px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
          value={excludeDraft}
          onChange={(e) => {
            const value = e.target.value
            setExcludeDraft(value)
            setExcludePatterns(value.split('\n').map((s) => s.trim()).filter(Boolean))
          }}
          placeholder={t('settings.scanExcludePlaceholder')}
          spellCheck={false}
        />
      </SettingsCard>

      <SettingsCard icon={<Archive className="h-4 w-4" />} title={t('settings.organizeBackup')} description={t('settings.organizeBackupDesc')}>
        <div className="space-y-4">
          <SettingsRow label={t('settings.organizeBackupEnable')} description={t('settings.organizeBackupEnableDesc')}>
            <Switch checked={backupBeforeOrganize} onCheckedChange={setBackupBeforeOrganize} />
          </SettingsRow>
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('settings.organizeBackupPath')}</label>
            <div className="flex gap-2">
              <Input value={backupDirectory} onChange={(e) => setBackupDirectory(e.target.value)} placeholder={t('settings.organizeBackupPathPlaceholder')} className="font-mono text-sm" />
              <Button type="button" variant="secondary" onClick={() => void pickBackupDirectory()}>{t('settings.organizeBackupBrowse')}</Button>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard icon={<Eye className="h-4 w-4" />} title={t('settings.watchFolder')} description={t('settings.watchFolderDesc')}>
        <div className="space-y-4">
          <SettingsRow label={t('settings.watchFolderEnable')} description={t('settings.watchFolderEnableDesc')}>
            <Switch checked={watchFolderEnabled} onCheckedChange={setWatchFolderEnabled} />
          </SettingsRow>
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('settings.watchFolderPaths')}</label>
            <textarea
              className="flex min-h-[100px] w-full rounded-2xl border border-input bg-iqon-row px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
              value={watchFolderPathsText}
              onChange={(e) => setWatchFolderPathsText(e.target.value)}
              placeholder={t('settings.watchFolderPathsPlaceholder')}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">{t('settings.watchFolderHint')}</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard icon={<Sun className="h-4 w-4" />} title={t('settings.theme')} description={t('settings.themeDesc')}>
        <div className="flex gap-2">
          {([
            { value: 'light' as Theme, label: t('settings.themeLight'), icon: <Sun className="h-4 w-4" /> },
            { value: 'dark' as Theme, label: t('settings.themeDark'), icon: <Moon className="h-4 w-4" /> },
            { value: 'system' as Theme, label: t('settings.themeSystem'), icon: null },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-colors ${
                theme === opt.value
                  ? 'border-iqon-green bg-iqon-green/10 text-iqon-green'
                  : 'border-iqon-border bg-iqon-card text-muted-foreground hover:border-iqon-borderSoft hover:text-foreground'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard id="ai-settings" title={t('settings.aiConfig')} description={t('settings.aiConfigDesc')}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-iqon-cyan/30 bg-iqon-cyan/5 p-4">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-iqon-cyan" />
            <div className="text-xs text-muted-foreground">
              <div className="font-bold text-foreground">{t('settings.aiIndependentTitle')}</div>
              <div className="mt-1">{t('settings.aiIndependentDesc')}</div>
            </div>
          </div>
          <SettingsRow label={t('settings.aiHardOnly')} description={t('settings.aiHardOnlyDesc')}>
            <Switch checked={aiOnlyHardCases} onCheckedChange={setAIOnlyHardCases} />
          </SettingsRow>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('settings.aiProvider')}</label>
              <Select value={localProvider.type} onValueChange={(v) => handleProviderChange(v as AIProvider['type'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">{t('settings.ollamaLocal')}</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="local_codex">{t('settings.codexLocal')}</SelectItem>
                  <SelectItem value="local_claude_code">{t('settings.claudeCodeLocal')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('settings.model')}</label>
              <Input value={localProvider.model} onChange={(e) => setLocalProvider({ ...localProvider, model: e.target.value })} placeholder={t('settings.modelPlaceholder')} />
            </div>
          </div>
          {localProvider.type === 'ollama' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('settings.ollamaHost')}</label>
              <Input value={localProvider.host} onChange={(e) => setLocalProvider({ ...localProvider, host: e.target.value })} placeholder="http://localhost:11434" />
            </div>
          )}
          {isLocalCliProvider(localProvider.type) && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('settings.cliExecutable')}</label>
              <Input
                value={localProvider.executable || ''}
                onChange={(e) => setLocalProvider({ ...localProvider, executable: e.target.value })}
                placeholder={localProvider.type === 'local_codex' ? 'codex' : 'claude'}
                className="font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground">{t('settings.cliExecutableDesc')}</p>
            </div>
          )}
          {(localProvider.type === 'openai' || localProvider.type === 'claude') && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">API Key</label>
              <Input type="password" value={localProvider.apiKey || ''} onChange={(e) => setLocalProvider({ ...localProvider, apiKey: e.target.value })} placeholder={t('settings.apiKeyPlaceholder')} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveProvider}><Save className="mr-2 h-4 w-4" />{t('settings.save')}</Button>
            <Button variant="outline" onClick={() => void testConnection()} disabled={testing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
              {t('settings.testConnection')}
            </Button>
            {testResult && (
              <span className={`text-xs font-bold ${testResult === 'success' ? 'text-iqon-green' : 'text-iqon-red'}`}>
                {testResult === 'success' ? t('settings.connectSuccess') : t('settings.connectFail')}
              </span>
            )}
          </div>
          {isLocalCliProvider(localProvider.type) && (testing || streamText || streamMessage) && (
            <div className="rounded-xl border border-iqon-border bg-[#101418] p-4 text-xs text-slate-200">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-iqon-cyan">
                {testing && <Loader2 className="h-3 w-3 animate-spin" />}
                {t('settings.aiStreamTitle')}
              </div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed">
                {streamText || streamMessage || t('settings.aiStreamWaiting')}
              </pre>
              {streamMessage && !testing && (
                <div className={`mt-3 border-t border-white/10 pt-2 text-[10px] ${testResult === 'success' ? 'text-iqon-green' : 'text-iqon-red'}`}>
                  {streamMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </SettingsCard>

      <MoleSystemSettingsSection />

      <CategoryRulesSection
        categories={categories}
        expandedIdx={expandedIdx}
        onExpandedIdxChange={setExpandedIdx}
        onAddCategory={addCategory}
        onUpdateCategory={updateCategory}
        onRemoveCategory={removeCategory}
        onMoveCategory={moveCategory}
        onResetCategories={resetCategories}
        onExportCategoryRules={() => void exportCategoryRules()}
        onImportCategoryRules={() => void importCategoryRules()}
      />
    </div>
  )
}

function SettingsCard({
  id,
  icon,
  title,
  description,
  children,
}: {
  id?: string
  icon?: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="iqon-card scroll-mt-6 p-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
        </div>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-iqon-border bg-iqon-row px-4 py-3">
      <div>
        <div className="text-xs font-bold text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  )
}
