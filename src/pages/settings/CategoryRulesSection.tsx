import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Category } from '@/stores/app'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'

type CategoryRulesSectionProps = {
  categories: Category[]
  expandedIdx: number | null
  onExpandedIdxChange: (index: number | null) => void
  onAddCategory: () => void
  onUpdateCategory: (index: number, updates: Partial<Category>) => void
  onRemoveCategory: (index: number) => void
  onMoveCategory: (index: number, direction: -1 | 1) => void
  onResetCategories: () => void
  onExportCategoryRules: () => void
  onImportCategoryRules: () => void
}

export function CategoryRulesSection({
  categories,
  expandedIdx,
  onExpandedIdxChange,
  onAddCategory,
  onUpdateCategory,
  onRemoveCategory,
  onMoveCategory,
  onResetCategories,
  onExportCategoryRules,
  onImportCategoryRules,
}: CategoryRulesSectionProps) {
  const { t } = useI18n()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{t('settings.categoryRules')}</CardTitle>
          <CardDescription>{t('settings.categoryRulesDesc')}</CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => void onExportCategoryRules()}>
            <Download className="mr-2 h-4 w-4" />
            {t('settings.rulesExport')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onImportCategoryRules()}>
            <Upload className="mr-2 h-4 w-4" />
            {t('settings.rulesImport')}
          </Button>
          <Button variant="outline" size="sm" onClick={onResetCategories}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('settings.resetDefaults')}
          </Button>
          <Button variant="outline" size="sm" onClick={onAddCategory}>
            <Plus className="mr-2 h-4 w-4" />
            {t('settings.addCategory')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {categories.map((cat, index) => {
            const isExpanded = expandedIdx === index
            return (
              <div key={index} className="overflow-hidden rounded-2xl border bg-surface-hover">
                <div
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                  onClick={() => onExpandedIdxChange(isExpanded ? null : index)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-lg">{cat.icon}</span>
                  <span className="flex-1 font-medium">{cat.name}</span>
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
                      onClick={() => onMoveCategory(index, -1)}
                      disabled={index === 0}
                      title={t('settings.moveUp')}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onMoveCategory(index, 1)}
                      disabled={index === categories.length - 1}
                      title={t('settings.moveDown')}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onRemoveCategory(index)}
                      disabled={cat.name === '其他'}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t px-4 pb-4 pt-1">
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3">
                      <Input
                        value={cat.icon}
                        onChange={(e) => onUpdateCategory(index, { icon: e.target.value })}
                        className="text-center"
                      />
                      <Input
                        value={cat.name}
                        onChange={(e) => onUpdateCategory(index, { name: e.target.value })}
                        placeholder={t('settings.categoryName')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('settings.extensionsPlaceholder')}
                      </label>
                      <Input
                        value={cat.extensions.join(', ')}
                        onChange={(e) =>
                          onUpdateCategory(index, {
                            extensions: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder={t('settings.extensionsPlaceholder')}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('settings.keywordsLabel')}
                      </label>
                      <Input
                        value={cat.keywords.join(', ')}
                        onChange={(e) =>
                          onUpdateCategory(index, {
                            keywords: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
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
  )
}
