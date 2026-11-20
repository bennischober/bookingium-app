import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, ExternalLink, Megaphone, UserPlus } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { MarketingActionDialog } from './MarketingActionDialog'
import {
  MARKETING_ACTION_STATUS_LABELS,
  type MarketingActionKind,
  type MarketingCategory,
  MARKETING_QUALITY_LABELS,
  MARKETING_STATUS_LABELS,
  MarketingStatus,
  type MarketingItemDto
} from '../../../../../main/api/schemas/marketing.schema'
import { t } from '../../../../../main/i18n/translate'

/** Categories whose entries can become a company or venue */
const CONTACT_CATEGORIES = new Set(['radios', 'podcasts', 'presse', 'clubs', 'festivals'])

const PRIORITY_STYLES = {
  A: 'bg-primary text-primary-foreground border-primary',
  B: 'border-foreground',
  C: 'border-dashed text-muted-foreground'
} as const

const STATUS_STYLES: Partial<Record<MarketingStatus, string>> = {
  contacted: 'border-l-amber-500',
  talking: 'border-l-amber-500',
  positive: 'border-l-green-600',
  active: 'border-l-green-600',
  declined: 'border-l-muted-foreground opacity-70'
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The kind a measure for an entry of the tab most likely is */
const KIND_OF: Partial<Record<MarketingCategory, MarketingActionKind>> = {
  radios: 'radio_spot',
  podcasts: 'interview',
  presse: 'print_ad',
  social: 'online_ad',
  festivals: 'poster',
  clubs: 'poster'
}

/** One atlas entry: summary line, status, the linked contact; details on click */
export function MarketingItemRow({ item }: { item: MarketingItemDto }) {
  const utils = trpcReact.useUtils()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(item.statusNote)
  const [planning, setPlanning] = useState(false)
  const refresh = () => utils.marketing.overview.invalidate(item.bandId)
  const update = trpcReact.marketing.update.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(t('Nicht gespeichert'), { description: error.message })
  })
  const link = trpcReact.marketing.linkContact.useMutation({
    onSuccess: async () => {
      await utils.invalidate()
      toast.success(t('„{{name}}“ ist jetzt im Adressbuch', { name: item.name }))
    },
    onError: (error) =>
      toast.error(t('Kontakt konnte nicht angelegt werden'), { description: error.message })
  })

  return (
    <li
      className={cn(
        'border-b border-l-4 border-l-transparent px-2 py-2.5',
        STATUS_STYLES[item.status],
        !item.inAtlas && 'opacity-60'
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded border text-sm font-semibold',
            PRIORITY_STYLES[item.priority]
          )}
          title={t('Priorität {{priority}}', { priority: item.priority })}
        >
          {item.priority}
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="flex items-center gap-1 font-medium">
            <ChevronRight
              className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')}
            />
            <span className="break-words">{item.name}</span>
          </span>
          <span className="ml-5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {item.country && <span>{item.country}</span>}
            {item.type && <span>{item.type}</span>}
            <span>{MARKETING_QUALITY_LABELS[item.quality]}</span>
            {!item.inAtlas && <span>{t('nicht mehr im Atlas')}</span>}
            {item.actionStatus && (
              <span className="font-medium text-foreground">
                {t('Maßnahme:')} {MARKETING_ACTION_STATUS_LABELS[item.actionStatus]}
              </span>
            )}
          </span>
          {!open && item.reason && (
            <span className="ml-5 mt-1 line-clamp-2 block text-sm text-muted-foreground">
              {item.reason}
            </span>
          )}
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.companyId !== null ? (
            <Link
              to="/companies/$companyId"
              params={{ companyId: String(item.companyId) }}
              className="text-sm text-primary hover:underline"
            >
              {item.companyName}
            </Link>
          ) : item.venueId !== null ? (
            <Link
              to="/venues/$venueId"
              params={{ venueId: String(item.venueId) }}
              className="text-sm text-primary hover:underline"
            >
              {item.venueName}
            </Link>
          ) : (
            CONTACT_CATEGORIES.has(item.category) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                disabled={link.isPending}
                onClick={() => link.mutate(item.id)}
              >
                <UserPlus className="h-3.5 w-3.5" />
                {t('Als Kontakt anlegen')}
              </Button>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setPlanning(true)}
          >
            <Megaphone className="h-3.5 w-3.5" />
            {t('Maßnahme')}
          </Button>
          <Select
            value={item.status}
            onValueChange={(status) =>
              update.mutate({ id: item.id, status: status as MarketingStatus })
            }
          >
            <SelectTrigger
              className="h-8 w-36"
              aria-label={t('Status von {{name}}', { name: item.name })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MarketingStatus.options.map((status) => (
                <SelectItem key={status} value={status}>
                  {MARKETING_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {open && (
        <dl className="ml-10 mt-2 grid max-w-3xl grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {item.reason && (
            <>
              <dt className="text-muted-foreground">{t('Warum')}</dt>
              <dd>{item.reason}</dd>
            </>
          )}
          {item.approach && (
            <>
              <dt className="text-muted-foreground">{t('Weg')}</dt>
              <dd>{item.approach}</dd>
            </>
          )}
          {item.timing && (
            <>
              <dt className="text-muted-foreground">{t('Timing')}</dt>
              <dd>{item.timing}</dd>
            </>
          )}
          {item.activeNote && (
            <>
              <dt className="text-muted-foreground">{t('Bisher')}</dt>
              <dd>
                <Badge variant="secondary">{item.activeNote}</Badge>
              </dd>
            </>
          )}
          {(item.contactEmail || item.contactUrl || item.contactNote) && (
            <>
              <dt className="text-muted-foreground">{t('Kontakt')}</dt>
              <dd className="space-y-0.5">
                {item.contactEmail && <span className="block select-all">{item.contactEmail}</span>}
                {item.contactUrl && (
                  <a
                    href={item.contactUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {host(item.contactUrl)} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {item.contactNote && (
                  <span className="block text-muted-foreground">{item.contactNote}</span>
                )}
              </dd>
            </>
          )}
          {item.sourceUrl && (
            <>
              <dt className="text-muted-foreground">{t('Quelle')}</dt>
              <dd>
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {host(item.sourceUrl)} <ExternalLink className="h-3 w-3" />
                </a>
              </dd>
            </>
          )}
          <dt className="pt-1.5 text-muted-foreground">{t('Notiz')}</dt>
          <dd>
            <Input
              className="h-8"
              aria-label={t('Notiz zu {{name}}', { name: item.name })}
              placeholder={t('z. B. Mail am 2.12. an die Musikredaktion')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() =>
                note !== item.statusNote && update.mutate({ id: item.id, statusNote: note })
              }
            />
            {item.statusDate && (
              <span className="text-xs text-muted-foreground">
                {t('Status seit')} {item.statusDate.split('-').reverse().join('.')}
              </span>
            )}
          </dd>
        </dl>
      )}
      {planning && (
        <MarketingActionDialog
          bandId={item.bandId}
          action={null}
          preset={{
            kind: KIND_OF[item.category] ?? 'other',
            title: item.name,
            companyId: item.companyId,
            marketingItemId: item.id
          }}
          open
          onOpenChange={(open) => !open && setPlanning(false)}
        />
      )}
    </li>
  )
}
