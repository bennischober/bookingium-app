import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { formatShortDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  isLinkableRecordType,
  type DocumentDto
} from '../../../../main/api/schemas/document.schema'
import type { DocumentLinkDto } from '../../../../main/api/schemas/document_link.schema'
import { LINK_KIND_LABELS, linkLabel } from './documentLinks'
import { shownName } from './documentSort'
import { t } from '../../../../main/i18n/translate'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

const sameRecord = (a: { kind: string; id: number }, b: { kind: string; id: number }) =>
  a.kind === b.kind && a.id === b.id

/**
 * "Zuordnen": the further records a document belongs to besides the one it is filed at – the
 * promoter, its contact, the festival. They list it under „Verträge & Dokumente“.
 */
export function DocumentLinksDialog({
  document,
  open,
  onOpenChange
}: {
  document: DocumentDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [query, setQuery] = useState('')
  const search = useDebounced(query.trim(), 200)
  const links = trpcReact.document.links.useQuery({ documentId: document.id }, { enabled: open })
  const targets = trpcReact.document.linkTargets.useQuery(
    { query: search },
    { enabled: open && search.length > 0 }
  )
  const setLink = trpcReact.document.setLink.useMutation({
    onSuccess: (next) => {
      utils.document.links.setData({ documentId: document.id }, next)
      void utils.document.related.invalidate()
    },
    onError: (error) =>
      toast.error(t('Zuordnung konnte nicht gespeichert werden'), { description: error.message })
  })

  const current = links.data ?? []
  const owner = { kind: document.ownerType, id: document.ownerId }
  const offered = (targets.data ?? []).filter(
    (target) => !sameRecord(target, owner) && !current.some((link) => sameRecord(link, target))
  )
  const change = (target: DocumentLinkDto, linked: boolean) => {
    // a release (#289) is never a link target
    if (!isLinkableRecordType(target.kind)) return
    setLink.mutate({ documentId: document.id, kind: target.kind, id: target.id, linked })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('„{{name}}“ zuordnen', { name: shownName(document) })}</DialogTitle>
          <DialogDescription>
            {t(
              'Die Datei bleibt, wo sie liegt. Zugeordnete Firmen, Personen, Clubs, Festivals, Bands und Events zeigen sie unter „Verträge & Dokumente“.'
            )}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2" aria-label={t('Zugeordnet')}>
          <h3 className="text-sm font-semibold">{t('Zugeordnet')}</h3>
          {current.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('Noch nichts zugeordnet.')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {current.map((link) => (
                <li key={`${link.kind}-${link.id}`}>
                  <Badge variant="secondary" className="gap-1 pr-1">
                    <span className="text-muted-foreground">{LINK_KIND_LABELS[link.kind]}</span>
                    {linkLabel(link)}
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-muted-foreground/20"
                      aria-label={t('{{name}} entfernen', { name: linkLabel(link) })}
                      disabled={setLink.isPending}
                      onClick={() => change(link, false)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <Input
            autoFocus
            placeholder={t('Suchen: Firma, Person, Club, Festival, Band, Event…')}
            aria-label={t('Eintrag zum Zuordnen suchen')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {search.length > 0 && targets.isSuccess && offered.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">{t('Nichts gefunden.')}</p>
            )}
            <ul aria-label={t('Suchergebnisse')}>
              {offered.map((target) => (
                <li key={`${target.kind}-${target.id}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                    disabled={setLink.isPending}
                    onClick={() => change(target, true)}
                  >
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      {LINK_KIND_LABELS[target.kind]}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {target.date ? `${formatShortDate(target.date)} ` : ''}
                      {target.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Fertig')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
