import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Flag,
  Forward,
  ImageOff,
  Link2,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  FilePlus,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { mailApi } from '@/lib/mailApi'
import { confirmAction } from '@/lib/confirm'
import { trpcReact, trpcVanilla } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { AttachmentToDocumentDialog } from '@/components/mail/AttachmentToDocumentDialog'
import type { MessageDetail } from '../../../../main/mailclient/core/types'
import {
  formatAddresses,
  formatFullDate,
  formatSize,
  messageKey,
  safeFileName,
  saveBytes
} from './format'
/** Every link of the mail with its real address; unsafe ones cannot be opened */
function LinkList({ message }: { message: MessageDetail }) {
  const [open, setOpen] = useState(false)
  // Copying is silent otherwise; a toast is the only feedback that it happened
  const copyLink = async (url: string): Promise<void> => {
    const result = await window.api.copyMailLink(url)
    if (result.success) toast.success('Link-Adresse kopiert')
    else toast.error('Kopieren fehlgeschlagen', { description: result.error })
  }
  if (message.links.length === 0) return null
  return (
    <footer className="max-h-[40%] shrink-0 overflow-auto border-t px-4 py-2 text-sm">
      <button
        type="button"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <Link2 className="size-4" />
        {message.links.length} {message.links.length === 1 ? 'Link' : 'Links'}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {message.links.map((link) => (
            <li key={link.index} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate">{link.text || '(ohne Text)'}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={link.url}>
                  {link.url}
                </p>
              </div>
              {link.openable ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    // The main process opens it in the default browser
                    onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                  >
                    Öffnen
                  </Button>
                  {/* F16: copy instead of open - for pasting into another browser or an incognito
                      window, which opening in the default browser cannot do. The clipboard lives in
                      the main process, so this goes through window.api. */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Link-Adresse kopieren"
                    aria-label={`Link-Adresse kopieren: ${link.url}`}
                    onClick={() => void copyLink(link.url)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-destructive">Gesperrt ({link.scheme || '?'})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </footer>
  )
}

/**
 * Reading pane. HTML mail is already sanitized by the core and shown in a
 * sandboxed iframe without scripts or same-origin access; its own CSP blocks
 * every remote load. Remote images are only fetched on request.
 */
export function MessageView({
  accountId,
  messageId,
  canWrite,
  inTrash,
  onToggleFlag,
  onDelete,
  onArchive,
  onMarkUnread,
  onCompose,
  onWriteTo
}: {
  accountId: string
  messageId: number
  canWrite: boolean
  inTrash: boolean
  onToggleFlag: (id: number, flagged: boolean) => void
  onDelete: (id: number) => void
  onArchive?: (id: number) => void
  /** Marks the open mail unread again */
  onMarkUnread?: (id: number) => void
  /** Opens the editor with a reply or forward of this mail (writable accounts only) */
  onCompose?: (message: MessageDetail, kind: 'reply' | 'replyAll' | 'forward') => void
  /** F2: opens a NEW mail to one header address (writable accounts only) */
  onWriteTo?: (address: { name: string; email: string }) => void
}) {
  const detail = useQuery({
    queryKey: messageKey(accountId, messageId),
    queryFn: () => mailApi.getMessage(messageId, accountId)
  })
  // The version with loaded remote images (the parent keys this view by message)
  const [withImages, setWithImages] = useState<MessageDetail | null>(null)
  const [loadingImages, setLoadingImages] = useState(false)
  // G10: how far the image load has got, so a 72-image mail is not an opaque spinner
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null)
  // C5: the attachment the "save as document" dialog is open for
  // F10: the dialog takes one attachment or all of them
  const [toDocument, setToDocument] = useState<{ partId: string; filename: string }[] | null>(null)
  // G10: the core reports progress per image; only this message's events matter.
  // This hook MUST stay above the early returns below - a hook after them is called on
  // some renders and not others, which is the Rules-of-Hooks violation that crashed the view.
  trpcReact.mail.events.useSubscription(undefined, {
    onData: (event) => {
      if (event.type !== 'image-progress') return
      if (event.accountId !== accountId || event.messageId !== messageId) return
      setImageProgress({ done: event.done, total: event.total })
    }
  })

  if (detail.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <p className="p-6 text-sm text-destructive">
        Die E-Mail konnte nicht geladen werden.
        {detail.error instanceof Error && ` ${detail.error.message}`}
      </p>
    )
  }

  const message = withImages ?? detail.data

  const loadImages = async () => {
    setLoadingImages(true)
    setImageProgress(null)
    try {
      setWithImages(await mailApi.loadRemoteImages(message.id, message.remoteImages, accountId))
    } catch (error) {
      toast.error('Bilder konnten nicht geladen werden', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setLoadingImages(false)
      setImageProgress(null)
    }
  }

  // B6: the main process writes the file; the renderer never gets a path to write to
  const attachmentInput = (partId: string, filename: string) => ({
    accountId,
    messageId: message.id,
    partId,
    filename
  })

  const openAttachment = async (partId: string, filename: string) => {
    try {
      const result = await trpcVanilla.mail.attachments.open.mutate(
        attachmentInput(partId, filename)
      )
      // An executable is never started without a second, explicit confirmation
      if (result.executable) {
        const confirmed = await confirmAction({
          title: `„${result.name}“ öffnen?`,
          description:
            'Das ist eine ausführbare Datei. Sie kann auf diesem Rechner Programme starten.',
          confirmLabel: 'Trotzdem öffnen',
          destructive: true
        })
        if (!confirmed) return
        await trpcVanilla.mail.attachments.openAnyway.mutate(attachmentInput(partId, filename))
      }
    } catch (error) {
      toast.error('Anhang konnte nicht geöffnet werden', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  /** F10: every attachment of this mail, one after another through the same save path */
  const saveAllAttachments = async (list: MessageDetail['attachments']) => {
    const visible = list.filter((a) => !a.isInline)
    for (const a of visible) await saveAttachmentAs(a.partId, a.filename)
  }

  const saveAttachmentAs = async (partId: string, filename: string) => {
    try {
      const result = await trpcVanilla.mail.attachments.saveAs.mutate(
        attachmentInput(partId, filename)
      )
      if (result.saved) toast.success('Anhang gespeichert', { description: result.name })
    } catch (error) {
      toast.error('Anhang konnte nicht gespeichert werden', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const saveEml = async () => {
    try {
      const bytes = await mailApi.getRawEml(message.id, accountId)
      saveBytes(
        bytes,
        `${safeFileName(message.subject, 'E-Mail').slice(0, 80)}.eml`,
        'message/rfc822'
      )
    } catch (error) {
      toast.error('E-Mail konnte nicht gespeichert werden', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="E-Mail">
      <header className="max-h-[50%] shrink-0 space-y-2 overflow-auto border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-semibold break-words">
            {message.subject || '(Kein Betreff)'}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {canWrite && (
              <>
                {onCompose && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCompose(message, 'reply')}
                      title="Antworten"
                      aria-label="Antworten"
                    >
                      <Reply />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCompose(message, 'replyAll')}
                      title="Allen antworten"
                      aria-label="Allen antworten"
                    >
                      <ReplyAll />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCompose(message, 'forward')}
                      title="Weiterleiten"
                      aria-label="Weiterleiten"
                    >
                      <Forward />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onToggleFlag(message.id, !message.isFlagged)}
                  title={message.isFlagged ? 'Markierung entfernen' : 'Markieren'}
                  aria-pressed={message.isFlagged}
                >
                  <Flag className={cn(message.isFlagged && 'fill-orange-500 text-orange-500')} />
                </Button>
                {onMarkUnread && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onMarkUnread(message.id)}
                    title="Als ungelesen markieren"
                  >
                    <Mail />
                  </Button>
                )}
                {onArchive && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onArchive(message.id)}
                    title="Archivieren"
                  >
                    <Archive />
                  </Button>
                )}
                {!inTrash && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(message.id)}
                    title="In den Papierkorb (Entf)"
                  >
                    <Trash2 />
                  </Button>
                )}
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void saveEml()}
              title="Original speichern (.eml)"
            >
              <Download />
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
          <dt className="text-muted-foreground">Von</dt>
          <dd className="truncate">
            <HeaderAddress
              address={{ name: message.fromName, email: message.fromEmail }}
              onWriteTo={onWriteTo}
            />
          </dd>
          <dt className="text-muted-foreground">An</dt>
          <dd className="truncate" title={formatAddresses(message.to)}>
            <HeaderAddressList addresses={message.to} onWriteTo={onWriteTo} />
          </dd>
          {message.cc.length > 0 && (
            <>
              <dt className="text-muted-foreground">Cc</dt>
              <dd className="truncate" title={formatAddresses(message.cc)}>
                <HeaderAddressList addresses={message.cc} onWriteTo={onWriteTo} />
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Datum</dt>
          <dd>{formatFullDate(message.date ?? message.internalDate)}</dd>
        </dl>

        {message.attachments.filter((a) => !a.isInline).length > 1 && (
          // F10: "save all" belongs to the whole set, not to one attachment's menu
          <div className="flex flex-wrap items-center gap-2" aria-label="Alle Anhänge">
            <span className="text-xs text-muted-foreground">
              {message.attachments.filter((a) => !a.isInline).length} Anhänge
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void saveAllAttachments(message.attachments)}
            >
              <Download />
              Alle speichern…
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setToDocument(
                  message.attachments
                    .filter((a) => !a.isInline)
                    .map((a) => ({ partId: a.partId, filename: a.filename }))
                )
              }
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
                      <div className="flex items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-r-none"
                          onClick={() => void openAttachment(a.partId, a.filename)}
                          title={`${a.contentType} · öffnen`}
                        >
                          <Paperclip />
                          <span className="max-w-56 truncate">{a.filename || 'Anhang'}</span>
                          <span className="text-muted-foreground">{formatSize(a.sizeBytes)}</span>
                        </Button>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-l-none border-l-0 px-1.5"
                            aria-label={`${a.filename || 'Anhang'}: weitere Aktionen`}
                            title="Weitere Aktionen"
                          >
                            <ChevronDown />
                          </Button>
                        </PopoverTrigger>
                      </div>
                    </PopoverAnchor>
                    <PopoverContent className="w-56 p-1" align="start">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => void saveAttachmentAs(a.partId, a.filename)}
                      >
                        <Download className="size-4 shrink-0 text-muted-foreground" />
                        Speichern unter…
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => setToDocument([{ partId: a.partId, filename: a.filename }])}
                      >
                        <FilePlus className="size-4 shrink-0 text-muted-foreground" />
                        Als Dokument speichern…
                      </button>
                    </PopoverContent>
                  </Popover>
                </li>
              ))}
          </ul>
        )}

        {message.remoteImageCount > 0 && !withImages && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm">
            <ImageOff className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              {message.remoteImageCount}{' '}
              {message.remoteImageCount === 1 ? 'externes Bild wurde' : 'externe Bilder wurden'}{' '}
              blockiert.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadImages()}
              disabled={loadingImages}
            >
              {loadingImages
                ? imageProgress
                  ? `Lädt… ${imageProgress.done} von ${imageProgress.total}`
                  : 'Wird geladen…'
                : 'Bilder laden'}
            </Button>
          </div>
        )}
      </header>

      {message.bodyKind === 'html' && message.html ? (
        <iframe
          // No allow-scripts, no allow-same-origin: the mail cannot run code
          // or reach the app. Links open as popups, which the main process
          // hands to the default browser.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={message.html}
          title="Inhalt der E-Mail"
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-sans text-sm whitespace-pre-wrap">
          {message.text}
        </pre>
      )}

      <LinkList message={message} />

      {toDocument && (
        <AttachmentToDocumentDialog
          open
          onOpenChange={(open) => {
            if (!open) setToDocument(null)
          }}
          accountId={accountId}
          messageId={message.id}
          storeMessageId={message.messageId}
          parts={toDocument}
        />
      )}
    </article>
  )
}

/**
 * F2: one address in a mail header. A button when the account may write, so a
 * click starts a NEW mail to that person - not a reply to this one.
 */
function HeaderAddress({
  address,
  onWriteTo
}: {
  address: { name: string; email: string }
  onWriteTo?: (address: { name: string; email: string }) => void
}) {
  const label = formatAddresses([address])
  if (!onWriteTo || !address.email) return <span title={label}>{label}</span>
  return (
    <button
      type="button"
      className="hover:underline"
      title={`Neue E-Mail an ${label}`}
      onClick={() => onWriteTo(address)}
    >
      {label}
    </button>
  )
}

/** The same for a list (An, Cc): every address is its own button */
function HeaderAddressList({
  addresses,
  onWriteTo
}: {
  addresses: { name: string; email: string }[]
  onWriteTo?: (address: { name: string; email: string }) => void
}) {
  if (addresses.length === 0) return <span>–</span>
  return (
    <>
      {addresses.map((address, index) => (
        <span key={`${address.email}-${index}`}>
          {index > 0 && ', '}
          <HeaderAddress address={address} onWriteTo={onWriteTo} />
        </span>
      ))}
    </>
  )
}
