import { useState } from 'react'
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

const isDocumentOwner = (type: string): type is DocumentOwnerType =>
  (DOCUMENT_OWNER_TYPES as readonly string[]).includes(type)

/**
 * C5: "Als Dokument speichern" for one attachment. The record is pre-selected from the
 * mail's links when it has exactly one, otherwise the user picks it; the file is written
 * by the main process with the same storage rules as an upload.
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
  // The first link is the best guess; the user can change both fields. Documents
  // hang off event/band/company/venue/person, so contract and invoice links are skipped.
  const first = links.data?.find((link) => isDocumentOwner(link.entityType))
  const firstOwner = first && isDocumentOwner(first.entityType) ? first.entityType : 'band'
  const [ownerType, setOwnerType] = useState<DocumentOwnerType>(firstOwner)
  const [ownerId, setOwnerId] = useState(String(first?.entityId ?? ''))
  const [documentType, setDocumentType] = useState<string>('other')

  const save = trpcReact.document.saveFromMail.useMutation({
    onSuccess: () => {
      toast.success('Als Dokument gespeichert')
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error('Anhang konnte nicht gespeichert werden', { description: error.message })
  })

  const id = Number(ownerId)
  const valid = Number.isInteger(id) && id > 0

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
              onValueChange={(value) => setOwnerType(value as DocumentOwnerType)}
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
            <Label htmlFor="attachment-owner-id">Nummer</Label>
            <Input
              id="attachment-owner-id"
              inputMode="numeric"
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
            />
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
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate({
                ownerType,
                ownerId: id,
                mailAccountId: accountId,
                messageId,
                partId,
                filename,
                mailMessageId: storeMessageId,
                documentType
              })
            }
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
