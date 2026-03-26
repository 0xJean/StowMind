import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { en } from './en'
import { zh } from './zh'

export type Locale = 'zh' | 'en'
type Messages = Record<keyof typeof zh, string>

const locales: Record<Locale, Messages> = { zh, en }

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: keyof Messages, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>(null!)

const STORAGE_KEY = 'stowmind-locale'

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'en' || saved === 'zh') return saved
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) => {
      let msg: string = locales[locale][key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          msg = msg.replace(`{${k}}`, String(v))
        }
      }
      return msg
    },
    [locale]
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
