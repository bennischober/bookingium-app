import { useMemo, useRef, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DOCUMENT_TYPE_LABELS,
  DocumentType,
  type DocumentOwnerType
} from '../../../../main/api/schemas/document.schema'
import { RecordPicker } from './RecordPicker'
import { isRecordType, useRecordChoices, type RecordChoice } from './recordChoices'

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
  parts
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  /** the mail store's row id */
  messageId: number
  /** the mail's Message-ID header, for the origin column */
  storeMessageId: string | null
  /** one or several attachments of the same mail; all go to the chosen record */
  parts: { partId: string; filename: string }[]
}) {
  const links = trpcReact.mailLink.linksForMessage.useQuery(
    { accountId, messageId: storeMessageId ?? '' },
    { enabled: open && Boolean(storeMessageId) }
  )
  // Documents hang off event/band/company/venue/person, so contract and invoice
  // links are skipped
  const linked = links.data?.find((link) => isRecordType(link.entityType))
  const linkedType: DocumentOwnerType = isRecordType(linked?.entityType ?? '')
    ? (linked!.entityType as DocumentOwnerType)
    : 'band'
  const [ownerType, setOwnerType] = useState<DocumentOwnerType>(linkedType)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<RecordChoice | null>(null)
  const [documentType, setDocumentType] = useState<string>('other')

  const choices = useRecordChoices(ownerType, search)
  // The mail's own link is offered first, so the common case is one click
  const linkedChoice = useMemo<RecordChoice | null>(() => {
    if (!linked || linked.entityType !== ownerType) return null
    return choices.find((c) => c.id === linked.entityId) ?? null
  }, [linked, ownerType, choices])

  const selected = chosen ?? linkedChoice
  const save = trpcReact.document.saveFromMail.useMutation({
    onSuccess: () => {
      saved.current += 1
      // One toast for the whole batch, not one per file
      if (saved.current === parts.length) {
        toast.success(
          parts.length === 1 ? 'Als Dokument gespeichert' : `${parts.length} Dokumente gespeichert`
        )
        onOpenChange(false)
      }
    },
    onError: (error) =>
      toast.error('Anhang konnte nicht gespeichert werden', { description: error.message })
  })
  const saved = useRef(0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Als Dokument speichern</DialogTitle>
          <DialogDescription>
            {parts.length === 1 ? parts[0].filename || 'Anhang' : `${parts.length} Anhänge`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <RecordPicker
            idPrefix="attachment-owner"
            typeLabel="Zuordnung"
            type={ownerType}
            onTypeChange={(type) => {
              setOwnerType(type)
              setChosen(null)
            }}
            search={search}
            onSearchChange={setSearch}
            choices={choices}
            selected={selected}
            onChoose={setChosen}
          />

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
              saved.current = 0
              for (const part of parts) {
                save.mutate({
                  ownerType,
                  ownerId: selected.id,
                  mailAccountId: accountId,
                  messageId,
                  partId: part.partId,
                  filename: part.filename,
                  mailMessageId: storeMessageId,
                  documentType
                })
              }
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
