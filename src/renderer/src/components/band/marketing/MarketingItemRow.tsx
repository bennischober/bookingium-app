import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, ExternalLink, UserPlus } from 'lucide-react'
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
import {
  MARKETING_QUALITY_LABELS,
  MARKETING_STATUS_LABELS,
  MarketingStatus,
  type MarketingItemDto
} from '../../../../../main/api/schemas/marketing.schema'

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

/** One atlas entry: summary line, status, the linked contact; details on click */
export function MarketingItemRow({ item }: { item: MarketingItemDto }) {
  const utils = trpcReact.useUtils()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(item.statusNote)
  const refresh = () => utils.marketing.overview.invalidate(item.bandId)
  const update = trpcReact.marketing.update.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error('Nicht gespeichert', { description: error.message })
  })
  const link = trpcReact.marketing.linkContact.useMutation({
    onSuccess: async () => {
      await utils.invalidate()
      toast.success(`„${item.name}“ ist jetzt im Adressbuch`)
    },
    onError: (error) =>
      toast.error('Kontakt konnte nicht angelegt werden', { description: error.message })
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
          title={`Priorität ${item.priority}`}
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
            {!item.inAtlas && <span>nicht mehr im Atlas</span>}
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
                Als Kontakt anlegen
              </Button>
            )
          )}
          <Select
            value={item.status}
            onValueChange={(status) =>
              update.mutate({ id: item.id, status: status as MarketingStatus })
            }
          >
            <SelectTrigger className="h-8 w-36" aria-label={`Status von ${item.name}`}>
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
              <dt className="text-muted-foreground">Warum</dt>
              <dd>{item.reason}</dd>
            </>
          )}
          {item.approach && (
            <>
              <dt className="text-muted-foreground">Weg</dt>
              <dd>{item.approach}</dd>
            </>
          )}
          {item.timing && (
            <>
              <dt className="text-muted-foreground">Timing</dt>
              <dd>{item.timing}</dd>
            </>
          )}
          {item.activeNote && (
            <>
              <dt className="text-muted-foreground">Bisher</dt>
              <dd>
                <Badge variant="secondary">{item.activeNote}</Badge>
              </dd>
            </>
          )}
          {(item.contactEmail || item.contactUrl || item.contactNote) && (
            <>
              <dt className="text-muted-foreground">Kontakt</dt>
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
              <dt className="text-muted-foreground">Quelle</dt>
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
          <dt className="pt-1.5 text-muted-foreground">Notiz</dt>
          <dd>
            <Input
              className="h-8"
              aria-label={`Notiz zu ${item.name}`}
              placeholder="z. B. Mail am 2.12. an die Musikredaktion"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() =>
                note !== item.statusNote && update.mutate({ id: item.id, statusNote: note })
              }
            />
            {item.statusDate && (
              <span className="text-xs text-muted-foreground">
                Status seit {item.statusDate.split('-').reverse().join('.')}
              </span>
            )}
          </dd>
        </dl>
      )}
    </li>
  )
}
