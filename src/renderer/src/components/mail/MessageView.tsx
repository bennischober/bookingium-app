import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  Flag,
  Forward,
  ImageOff,
  Link2,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { mailApi } from '@/lib/mailApi'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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
                <Button
                  variant="outline"
                  size="sm"
                  // The main process opens it in the default browser
                  onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                >
                  Öffnen
                </Button>
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
  onCompose
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
}) {
  const detail = useQuery({
    queryKey: messageKey(accountId, messageId),
    queryFn: () => mailApi.getMessage(messageId, accountId)
  })
  // The version with loaded remote images (the parent keys this view by message)
  const [withImages, setWithImages] = useState<MessageDetail | null>(null)
  const [loadingImages, setLoadingImages] = useState(false)

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
    try {
      setWithImages(await mailApi.loadRemoteImages(message.id, message.remoteImages, accountId))
    } catch (error) {
      toast.error('Bilder konnten nicht geladen werden', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setLoadingImages(false)
    }
  }

  const saveAttachment = async (partId: string, filename: string, contentType: string) => {
    try {
      const bytes = await mailApi.getAttachment(message.id, partId, accountId)
      saveBytes(bytes, safeFileName(filename, 'Anhang'), contentType)
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
                    >
                      <Reply />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCompose(message, 'replyAll')}
                      title="Allen antworten"
                    >
                      <ReplyAll />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCompose(message, 'forward')}
                      title="Weiterleiten"
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
            {formatAddresses([{ name: message.fromName, email: message.fromEmail }])}
          </dd>
          <dt className="text-muted-foreground">An</dt>
          <dd className="truncate" title={formatAddresses(message.to)}>
            {formatAddresses(message.to) || '–'}
          </dd>
          {message.cc.length > 0 && (
            <>
              <dt className="text-muted-foreground">Cc</dt>
              <dd className="truncate" title={formatAddresses(message.cc)}>
                {formatAddresses(message.cc)}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Datum</dt>
          <dd>{formatFullDate(message.date ?? message.internalDate)}</dd>
        </dl>

        {message.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Anhänge">
            {message.attachments
              .filter((a) => !a.isInline)
              .map((a) => (
                <li key={a.partId}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void saveAttachment(a.partId, a.filename, a.contentType)}
                    title={`${a.contentType} · speichern`}
                  >
                    <Paperclip />
                    <span className="max-w-56 truncate">{a.filename || 'Anhang'}</span>
                    <span className="text-muted-foreground">{formatSize(a.sizeBytes)}</span>
                  </Button>
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
              {loadingImages ? 'Wird geladen…' : 'Bilder laden'}
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
    </article>
  )
}
