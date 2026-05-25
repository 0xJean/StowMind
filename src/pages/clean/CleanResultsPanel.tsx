import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { ChevronDown, ChevronRight, FileText, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MoleCleanItem, MoleCleanPreview, MoleCleanSection } from './types'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'success' | 'warning'> = {
  dry_run: 'warning',
  ok: 'success',
  skipped: 'secondary',
  advice: 'outline',
  info: 'outline',
  detail: 'secondary',
}

interface CleanResultsPanelProps {
  preview: MoleCleanPreview
  sections: MoleCleanSection[]
  onClean: () => void
}

export function CleanResultsPanel({ preview, sections, onClean }: CleanResultsPanelProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const cleanableCount = useMemo(() => {
    return sections.reduce((sum, section) => sum + section.items.reduce((itemSum, item) => itemSum + (item.count ?? 0), 0), 0)
  }, [sections])

  useEffect(() => {
    setExpanded(new Set())
  }, [preview.raw_output])

  const toggleSection = (title: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(title)) {
        next.delete(title)
      } else {
        next.add(title)
      }
      return next
    })
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>{t('clean.cleanableTitle')}</CardTitle>
            <CardDescription>
              {t('clean.cleanableSummary', {
                size: formatFileSize(preview.potential_space),
                count: preview.item_count,
                categories: preview.category_count,
              })}
            </CardDescription>
          </div>
          <span className="text-sm font-semibold text-muted-foreground">
            {t('clean.cleanableSelected', {
              count: cleanableCount || preview.item_count,
              total: preview.item_count,
            })}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 p-6">
        {sections.map((section, sectionIndex) => {
          const sectionSize = section.items.reduce((sum, item) => sum + itemSize(item), 0)
          const sectionCount = section.items.reduce((sum, item) => sum + (item.count ?? 0), 0)
          const open = expanded.has(section.title)
          return (
            <div key={section.title} className="overflow-hidden rounded-2xl bg-surface-hover/80">
              <button
                type="button"
                className="flex w-full items-center gap-4 px-4 py-4 text-left"
                onClick={() => toggleSection(section.title)}
              >
                <input
                  type="checkbox"
                  className="stow-checkbox shrink-0"
                  checked={sectionSize > 0 || section.items.length > 0}
                  readOnly
                  aria-label={section.title}
                  onClick={(event) => event.preventDefault()}
                />
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cleanTone(sectionIndex)}`}>
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="truncate text-sm font-bold">{section.title}</h3>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {t('clean.cleanableSectionCount', {
                        selected: sectionCount || section.items.length,
                        total: sectionCount || section.items.length,
                      })}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {section.items[0]?.label ?? t('clean.cleanableSectionEmpty')}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold text-primary">
                  {sectionSize > 0 ? formatFileSize(sectionSize) : t('clean.cleanableNoSize')}
                </span>
                {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>

              {open && (
                <div className="space-y-2 border-t border-border/60 px-4 py-3">
                  {section.items.map((item, index) => (
                    <CleanResultItem key={`${section.title}-${index}`} item={item} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border/70 bg-card/95 p-6 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div className="text-sm font-medium text-muted-foreground">
          {t('clean.cleanableFooter', {
            count: preview.item_count,
            size: formatFileSize(preview.potential_space),
          })}
        </div>
        <Button type="button" size="lg" className="min-w-64" onClick={onClean}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('clean.cleanableAction', { size: formatFileSize(preview.potential_space) })}
        </Button>
      </div>
    </Card>
  )
}

function CleanResultItem({ item }: { item: MoleCleanItem }) {
  const { t } = useI18n()

  return (
    <div className="flex items-start gap-3 rounded-xl bg-background/50 px-3 py-2">
      <Badge variant={STATUS_VARIANT[item.status] ?? 'secondary'} className="mt-0.5 shrink-0">
        {statusLabel(item.status, t)}
      </Badge>
      <p className="min-w-0 flex-1 break-words text-sm">{item.label}</p>
      {item.count ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t('clean.itemCountShort', { count: item.count })}
        </span>
      ) : null}
      {item.size ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatFileSize(item.size)}
        </span>
      ) : null}
    </div>
  )
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']) {
  const key = `clean.status.${status}` as Parameters<typeof t>[0]
  return t(key)
}

function itemSize(item: MoleCleanItem) {
  return typeof item.size === 'number' && item.size > 0 ? item.size : 0
}

function cleanTone(index: number) {
  const tones = [
    'bg-clean-red/10 text-clean-red',
    'bg-primary/10 text-primary',
    'bg-clean-yellow/15 text-yellow-600 dark:text-clean-yellow',
    'bg-clean-green/10 text-clean-green',
    'bg-clean-cyan/10 text-clean-cyan',
  ]
  return tones[index % tones.length]
}
