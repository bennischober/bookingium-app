import { Building2, ChevronDown, Download, FilePlus, Paperclip, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { MessageDetail } from '../../../../main/mailclient/core/types'
import { NOT_LOADED_NOTE } from './completion'
import { formatSize } from './format'
import { CompanyEnrichmentHint } from '@/components/company/CompanyEnrichmentHint'

type Attachments = MessageDetail['attachments']

/** #222: a PDF or XML attachment may be an e-invoice */
const mayBeEInvoice = (a: Attachments[number]): boolean =>
  /\.(pdf|xml)$/i.test(a.filename ?? '') || /pdf|xml/i.test(a.contentType)

/** #225: what can become a receipt: PDF, e-invoice XML, or a photo */
const mayBeReceipt = (a: Attachments[number]): boolean =>
  mayBeEInvoice(a) ||
  /\.(jpe?g|png)$/i.test(a.filename ?? '') ||
  /image\/(jpeg|png)/i.test(a.contentType)

/** "Save all" for several attachments, then one chip per attachment */
export function MessageAttachments({
  message,
  downloading,
  openAttachment,
  saveAttachmentAs,
  saveAllAttachments,
  toDocuments,
  toCompany,
  toReceipt,
  accountId
}: {
  message: MessageDetail
  /** S1: the whole message is being downloaded; every file action waits for it */
  downloading: boolean
  openAttachment: (partId: string) => Promise<void>
  saveAttachmentAs: (partId: string) => Promise<void>
  saveAllAttachments: () => Promise<void>
  /** C5 / F10: opens the "save as document" dialog for the picked attachments */
  toDocuments: (pick: (done: MessageDetail) => Attachments) => Promise<void>
  /** #222: opens "Firma aus E-Rechnung" for the attachment */
  toCompany?: (partId: string) => Promise<void>
  /** #225: opens "Beleg speichern" for the attachment */
  toReceipt?: (partId: string) => Promise<void>
  /** #236: the account, to check invoice attachments against the companies */
  accountId?: string
}) {
  return (
    <>
      {message.attachments.filter((a) => !a.isInline).length > 1 && (
        // F10: "save all" belongs to the whole set, not to one attachment's menu
        // I16 item 22: aria-label on a plain div is ignored; a role makes the name reach assistive tech
        <div role="group" className="flex flex-wrap items-center gap-2" aria-label="Alle Anhänge">
          <span className="text-xs text-muted-foreground">
            {message.attachments.filter((a) => !a.isInline).length} Anhänge
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void saveAllAttachments()}
            disabled={downloading}
          >
            <Download />
            Alle speichern…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toDocuments((done) => done.attachments.filter((a) => !a.isInline))}
            disabled={downloading}
          >
            <FilePlus />
            Alle als Dokument…
          </Button>
        </div>
      )}

      {message.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Anhänge">
          {message.attachments
            .filter((a) => !a.isInline)
            .map((a) => (
              <li key={a.partId}>
                {/* F10: a click opens the file; the chevron holds the rest, so the
                      three actions do not clutter the chip */}
                <Popover>
                  <PopoverAnchor asChild>
                    <ButtonGroup aria-label={a.filename || 'Anhang'}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openAttachment(a.partId)}
                        disabled={downloading}
                        title={`${a.contentType} · ${message.complete ? 'öffnen' : NOT_LOADED_NOTE}`}
                      >
                        <Paperclip />
                        <span className="max-w-56 truncate">{a.filename || 'Anhang'}</span>
                        {/* S1: until the download, the size is BODYSTRUCTURE's estimate */}
                        <span className="text-muted-foreground">
                          {message.complete ? '' : '≈ '}
                          {formatSize(a.sizeBytes)}
                        </span>
                        {!message.complete && (
                          <span className="text-xs text-muted-foreground">· {NOT_LOADED_NOTE}</span>
                        )}
                      </Button>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="px-1.5"
                          aria-label={`${a.filename || 'Anhang'}: weitere Aktionen`}
                          disabled={downloading}
                          title="Weitere Aktionen"
                        >
                          <ChevronDown />
                        </Button>
                      </PopoverTrigger>
                    </ButtonGroup>
                  </PopoverAnchor>
                  {/* Under the chevron that opens it; Radix shifts it back in when there is no room */}
                  <PopoverContent className="w-56 p-1" align="end">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => void saveAttachmentAs(a.partId)}
                    >
                      <Download className="size-4 shrink-0 text-muted-foreground" />
                      Speichern unter…
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() =>
                        void toDocuments((done) =>
                          done.attachments.filter((x) => x.partId === a.partId)
                        )
                      }
                    >
                      <FilePlus className="size-4 shrink-0 text-muted-foreground" />
                      Als Dokument speichern…
                    </button>
                    {toCompany && mayBeEInvoice(a) && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => void toCompany(a.partId)}
                      >
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                        Firma aus E-Rechnung…
                      </button>
                    )}
                    {toReceipt && mayBeReceipt(a) && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => void toReceipt(a.partId)}
                      >
                        <Receipt className="size-4 shrink-0 text-muted-foreground" />
                        Als Beleg speichern…
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              </li>
            ))}
        </ul>
      )}

      {/* #236: an invoice of a known company with empty fields; only once downloaded */}
      {accountId &&
        message.complete &&
        message.attachments
          .filter((a) => !a.isInline && mayBeEInvoice(a))
          .slice(0, 3)
          .map((a) => (
            <CompanyEnrichmentHint
              key={a.partId}
              source={{ kind: 'attachment', accountId, messageId: message.id, partId: a.partId }}
              senderEmail={message.fromEmail}
            />
          ))}
    </>
  )
}
