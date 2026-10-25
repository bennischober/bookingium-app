import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DOCUMENT_OWNER_TYPES,
  DOCUMENT_TYPE_LABELS,
  DocumentType,
  type DocumentOwnerType
} from '../../../../main/api/schemas/document.schema'

const OWNER_LABELS: Record<DocumentOwnerType, string> = {
  event: 'Event',
  band: 'Band',
  company: 'Firma',
  venue: 'Spielstätte',
  person: 'Person'
}

/** One record the picker can offer */
type Choice = { id: number; label: string }

const isDocumentOwner = (type: string): type is DocumentOwnerType =>
  (DOCUMENT_OWNER_TYPES as readonly string[]).includes(type)

/**
 * F9: "Als Dokument speichern" for one attachment.
 *
 * The record is picked by NAME, not by number - nobody knows the id of a band. The
 * list comes from the same paginated search the record's own page uses, so a partial
 * name is enough. The mail's links pre-select the type and the record when they name
 * exactly one.
 */
export function AttachmentToDocumentDialog({
  open,
  onOpenChange,
  accountId,
  messageId,
  storeMessageId,
  partId,
  filename
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  /** the mail store's row id */
  messageId: number
  /** the mail's Message-ID header, for the origin column */
  storeMessageId: string | null
  partId: string
  filename: string
}) {
  const links = trpcReact.mailLink.linksForMessage.useQuery(
    { accountId, messageId: storeMessageId ?? '' },
    { enabled: open && Boolean(storeMessageId) }
  )
  // Documents hang off event/band/company/venue/person, so contract and invoice
  // links are skipped
  const linked = links.data?.find((link) => isDocumentOwner(link.entityType))
  const linkedType: DocumentOwnerType = isDocumentOwner(linked?.entityType ?? '')
    ? (linked!.entityType as DocumentOwnerType)
    : 'band'
  const [ownerType, setOwnerType] = useState<DocumentOwnerType>(linkedType)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<Choice | null>(null)
  const [documentType, setDocumentType] = useState<string>('other')

  const choices = useOwnerChoices(ownerType, search)
  // The mail's own link is offered first, so the common case is one click
  const linkedChoice = useMemo<Choice | null>(() => {
    if (!linked || linked.entityType !== ownerType) return null
    return choices.find((c) => c.id === linked.entityId) ?? null
  }, [linked, ownerType, choices])

  const selected = chosen ?? linkedChoice
  const save = trpcReact.document.saveFromMail.useMutation({
    onSuccess: () => {
      toast.success('Als Dokument gespeichert')
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error('Anhang konnte nicht gespeichert werden', { description: error.message })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Als Dokument speichern</DialogTitle>
          <DialogDescription>{filename || 'Anhang'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="attachment-owner-type">Zuordnung</Label>
            <Select
              value={ownerType}
              onValueChange={(value) => {
                setOwnerType(value as DocumentOwnerType)
                setChosen(null)
              }}
            >
              <SelectTrigger id="attachment-owner-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_OWNER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {OWNER_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="attachment-owner-search">{OWNER_LABELS[ownerType]} suchen</Label>
            <Input
              id="attachment-owner-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name eingeben…"
              autoComplete="off"
            />
            {/* The matches, so the record is picked by name instead of by number */}
            <ul
              aria-label="Treffer"
              className="max-h-48 overflow-auto rounded-md border empty:hidden"
            >
              {choices.map((choice) => {
                const active = selected?.id === choice.id
                return (
                  <li key={choice.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${
                        active ? 'bg-muted font-medium' : ''
                      }`}
                      aria-pressed={active}
                      onClick={() => setChosen(choice)}
                    >
                      {choice.label}
                    </button>
                  </li>
                )
              })}
            </ul>
            {selected && (
              <p className="text-xs text-muted-foreground">Ausgewählt: {selected.label}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="attachment-document-type">Dokumententyp</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger id="attachment-document-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DocumentType.options.map((type) => (
                  <SelectItem key={type} value={type}>
                    {DOCUMENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!selected || save.isPending}
            onClick={() => {
              if (!selected) return
              save.mutate({
                ownerType,
                ownerId: selected.id,
                mailAccountId: accountId,
                messageId,
                partId,
                filename,
                mailMessageId: storeMessageId,
                documentType
              })
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * F9: the records of one type, searched by name through that type's own list
 * procedure - the same one its page uses, so the results match what the user knows.
 */
function useOwnerChoices(type: DocumentOwnerType, search: string): Choice[] {
  const input = { page: 1, pageSize: 20, search: search.trim() || undefined }
  // One query per type: the hooks cannot be called conditionally
  const bands = trpcReact.band.getAllPaginated.useQuery(input, { enabled: type === 'band' })
  const persons = trpcReact.person.getAllPaginated.useQuery(input, { enabled: type === 'person' })
  const companies = trpcReact.company.getAllPaginated.useQuery(input, {
    enabled: type === 'company'
  })
  const venues = trpcReact.venue.getAllPaginated.useQuery(input, { enabled: type === 'venue' })
  const events = trpcReact.dealMemo.getAllPaginated.useQuery(input, { enabled: type === 'event' })

  return useMemo(() => {
    switch (type) {
      case 'band':
        return (bands.data?.items ?? []).map((r) => ({ id: r.id, label: r.name }))
      case 'person':
        return (persons.data?.items ?? []).map((r) => ({
          id: r.id,
          label: [r.firstName, r.lastName].filter(Boolean).join(' ') || `Person ${r.id}`
        }))
      case 'company':
        return (companies.data?.items ?? []).map((r) => ({ id: r.id, label: r.name }))
      case 'venue':
        return (venues.data?.items ?? []).map((r) => ({ id: r.id, label: r.name }))
      case 'event':
        return (events.data?.items ?? []).map((r) => ({
          id: r.id,
          label: [r.name, r.deal].filter(Boolean).join(' · ')
        }))
    }
  }, [type, bands.data, persons.data, companies.data, venues.data, events.data])
}
