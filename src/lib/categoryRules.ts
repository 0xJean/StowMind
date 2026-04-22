import type { Category } from '@/stores/app'
import { defaultCategories } from '@/stores/app'

export const CATEGORY_RULES_EXPORT_VERSION = 1

export interface CategoryRulesFile {
  version: number
  /** StowMind 分类模板 */
  app?: string
  categories: Category[]
}

export function serializeCategories(categories: Category[]): string {
  const payload: CategoryRulesFile = {
    version: CATEGORY_RULES_EXPORT_VERSION,
    app: 'StowMind',
    categories,
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * 解析导入的 JSON：支持 `{ version, categories: [...] }` 或顶层即为分类数组。
 * 若缺少「其他」分类则自动追加默认「其他」。
 */
export function parseCategoriesImport(text: string): Category[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('json')
  }

  let list: unknown[]
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    'categories' in parsed &&
    Array.isArray((parsed as CategoryRulesFile).categories)
  ) {
    list = (parsed as CategoryRulesFile).categories
  } else {
    throw new Error('shape')
  }

  if (list.length === 0) {
    throw new Error('empty')
  }

  const out: Category[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const icon = typeof o.icon === 'string' ? o.icon : '📁'
    const extensions = Array.isArray(o.extensions)
      ? o.extensions.filter((x): x is string => typeof x === 'string')
      : []
    const keywords = Array.isArray(o.keywords)
      ? o.keywords.filter((x): x is string => typeof x === 'string')
      : []
    if (!name) continue
    out.push({ name, icon, extensions, keywords })
  }

  if (out.length === 0) {
    throw new Error('none')
  }

  if (!out.some((c) => c.name === '其他')) {
    const fallback = defaultCategories.find((c) => c.name === '其他')
    if (fallback) {
      out.push({ ...fallback })
    }
  }

  return out
}
