import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTheme, type Theme } from '@/hooks/useTheme'
import { useI18n, type Locale } from '@/i18n'
import { AIProvider, Category, defaultCategories, useAppStore } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Globe, Moon, Plus, RefreshCw, RotateCcw, Save, Sun, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function SettingsPage() {
  const location = useLocation()
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const aiProvider = useAppStore((s) => s.aiProvider)
  const setAIProvider = useAppStore((s) => s.setAIProvider)
  const categories = useAppStore((s) => s.categories)
  const setCategories = useAppStore((s) => s.setCategories)
  const setOllamaOnline = useAppStore((s) => s.setOllamaOnline)
  const aiOnlyHardCases = useAppStore((s) => s.aiOnlyHardCases)
  const setAIOnlyHardCases = useAppStore((s) => s.setAIOnlyHardCases)
  const excludePatterns = useAppStore((s) => s.excludePatterns)
  const setExcludePatterns = useAppStore((s) => s.setExcludePatterns)
  const [excludeDraft, setExcludeDraft] = useState(() => excludePatterns.join('\n'))

  useEffect(() => {
    setExcludeDraft(excludePatterns.join('\n'))
  }, [location.pathname])

  const [localProvider, setLocalProvider] = useState<AIProvider>(aiProvider)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)

  const handleProviderChange = (type: AIProvider['type']) => {
    const defaults: Record<AIProvider['type'], Partial<AIProvider>> = {
      ollama: { host: 'http://localhost:11434', model: 'qwen3:4b' },
      openai: { model: 'gpt-4o-mini' },
      claude: { model: 'claude-3-haiku-20240307' },
    }
    setLocalProvider({ ...localProvider, type, ...defaults[type] })
  }

  const saveProvider = () => {
    setAIProvider(localProvider)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    
    try {
      if (localProvider.type === 'ollama') {
        const online = await invoke<boolean>('check_ollama', { 
          host: localProvider.host 
        })
        setTestResult(online ? 'success' : 'error')
        setOllamaOnline(online)
      } else {
        const result = await invoke<boolean>('test_api_connection', {
          provider: localProvider
        })
        setTestResult(result ? 'success' : 'error')
      }
    } catch {
      setTestResult('error')
    } finally {
      setTesting(false)
    }
  }

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const addCategory = () => {
    const newCats = [
      ...categories,
      { name: t('settings.newCategory'), icon: '📁', extensions: [], keywords: [] }
    ]
    setCategories(newCats)
    setExpandedIdx(newCats.length - 1)
  }

  const updateCategory = (index: number, updates: Partial<Category>) => {
    const newCategories = [...categories]
    newCategories[index] = { ...newCategories[index], ...updates }
    setCategories(newCategories)
  }

  const removeCategory = (index: number) => {
    setCategories(categories.filter((_, i) => i !== index))
    if (expandedIdx === index) setExpandedIdx(null)
  }

  const moveCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= categories.length) return
    const newCats = [...categories]
    ;[newCats[index], newCats[target]] = [newCats[target], newCats[index]]
    setCategories(newCats)
    setExpandedIdx(target)
  }

  const resetCategories = () => {
    if (window.confirm(t('settings.resetConfirm'))) {
      setCategories(defaultCategories)
      setExpandedIdx(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      {/* Brand */}
      <Card>
        <CardHeader>
          <CardTitle>StowMind</CardTitle>
          <CardDescription>StowMind — AI file organizer</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <img
              src="/icon.svg"
              alt="StowMind"
              className="w-10 h-10 rounded-2xl"
              draggable={false}
            />
            <div className="text-sm text-muted-foreground">
              {t('settings.brandSubtitle')}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            {t('settings.language')}
          </CardTitle>
          <CardDescription>{t('settings.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Scan exclusions */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.scanExclude')}</CardTitle>
          <CardDescription>{t('settings.scanExcludeDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
            value={excludeDraft}
            onChange={(e) => {
              const v = e.target.value
              setExcludeDraft(v)
              setExcludePatterns(
                v
                  .split('\n')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0)
              )
            }}
            placeholder={t('settings.scanExcludePlaceholder')}
            spellCheck={false}
          />
        </CardContent>
      </Card>

      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="w-5 h-5" />
            {t('settings.theme')}
          </CardTitle>
          <CardDescription>{t('settings.themeDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {([
              { value: 'light' as Theme, label: t('settings.themeLight'), icon: <Sun className="w-4 h-4" /> },
              { value: 'dark' as Theme, label: t('settings.themeDark'), icon: <Moon className="w-4 h-4" /> },
              { value: 'system' as Theme, label: t('settings.themeSystem'), icon: null },
            ]).map((opt) => (
              <Button
                key={opt.value}
                variant={theme === opt.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme(opt.value)}
                className="gap-2"
              >
                {opt.icon}
                {opt.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Config */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.aiConfig')}</CardTitle>
          <CardDescription>{t('settings.aiConfigDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
            <div>
              <div className="text-sm font-medium">{t('settings.aiHardOnly')}</div>
              <div className="text-xs text-muted-foreground">
                {t('settings.aiHardOnlyDesc')}
              </div>
            </div>
            <Switch checked={aiOnlyHardCases} onCheckedChange={setAIOnlyHardCases} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('settings.aiProvider')}</label>
              <Select
                value={localProvider.type}
                onValueChange={(v) => handleProviderChange(v as AIProvider['type'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">{t('settings.ollamaLocal')}</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('settings.model')}</label>
              <Input
                value={localProvider.model}
                onChange={(e) => setLocalProvider({ ...localProvider, model: e.target.value })}
                placeholder={t('settings.modelPlaceholder')}
              />
            </div>
          </div>

          {localProvider.type === 'ollama' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('settings.ollamaHost')}</label>
              <Input
                value={localProvider.host}
                onChange={(e) => setLocalProvider({ ...localProvider, host: e.target.value })}
                placeholder="http://localhost:11434"
              />
            </div>
          )}

          {(localProvider.type === 'openai' || localProvider.type === 'claude') && (
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <Input
                type="password"
                value={localProvider.apiKey || ''}
                onChange={(e) => setLocalProvider({ ...localProvider, apiKey: e.target.value })}
                placeholder={t('settings.apiKeyPlaceholder')}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={saveProvider}>
              <Save className="w-4 h-4 mr-2" />
              {t('settings.save')}
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${testing ? 'animate-spin' : ''}`} />
              {t('settings.testConnection')}
            </Button>
            {testResult && (
              <Badge variant={testResult === 'success' ? 'success' : 'destructive'}>
                {testResult === 'success' ? t('settings.connectSuccess') : t('settings.connectFail')}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Category Rules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('settings.categoryRules')}</CardTitle>
            <CardDescription>{t('settings.categoryRulesDesc')}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetCategories}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {t('settings.resetDefaults')}
            </Button>
            <Button variant="outline" size="sm" onClick={addCategory}>
              <Plus className="w-4 h-4 mr-2" />
              {t('settings.addCategory')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {categories.map((cat, index) => {
              const isExpanded = expandedIdx === index
              return (
                <div
                  key={index}
                  className="rounded-lg border bg-muted/30 overflow-hidden"
                >
                  {/* Collapsed header row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedIdx(isExpanded ? null : index)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-lg">{cat.icon}</span>
                    <span className="font-medium flex-1">{cat.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('settings.nExtensions', { n: cat.extensions.length })}
                      {' · '}
                      {t('settings.nKeywords', { n: cat.keywords.length })}
                    </span>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveCategory(index, -1)}
                        disabled={index === 0}
                        title={t('settings.moveUp')}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveCategory(index, 1)}
                        disabled={index === categories.length - 1}
                        title={t('settings.moveDown')}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeCategory(index)}
                        disabled={cat.name === '其他'}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t">
                      <div className="grid grid-cols-[4rem_1fr] gap-3 items-center">
                        <Input
                          value={cat.icon}
                          onChange={(e) => updateCategory(index, { icon: e.target.value })}
                          className="text-center"
                        />
                        <Input
                          value={cat.name}
                          onChange={(e) => updateCategory(index, { name: e.target.value })}
                          placeholder={t('settings.categoryName')}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{t('settings.extensionsPlaceholder')}</label>
                        <Input
                          value={cat.extensions.join(', ')}
                          onChange={(e) => updateCategory(index, { 
                            extensions: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          })}
                          placeholder={t('settings.extensionsPlaceholder')}
                          className="text-sm font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{t('settings.keywordsLabel')}</label>
                        <Input
                          value={cat.keywords.join(', ')}
                          onChange={(e) => updateCategory(index, {
                            keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          })}
                          placeholder={t('settings.keywordsPlaceholder')}
                          className="text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
