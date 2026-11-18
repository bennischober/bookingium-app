import {
  Archive,
  CalendarCheck,
  CalendarPlus,
  Download,
  Flag,
  Forward,
  Mail,
  Reply,
  ReplyAll,
  Tags,
  Trash2,
  UserPlus,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { MessageDetail } from '../../../../main/mailclient/core/types'

type Compose = (message: MessageDetail, kind: 'reply' | 'replyAll' | 'forward') => void

/**
 * The reader's action buttons. Reply, flag, archive and delete change the mailbox and need
 * a writable account; the rest only change the app's data and work on read-only ones too.
 */
export function MessageActions({
  message,
  canWrite,
  inTrash,
  downloading,
  onCompose,
  forward,
  onToggleFlag,
  onMarkUnread,
  onArchive,
  onSpam,
  onNotSpam,
  onDelete,
  onLink,
  onCreateEvent,
  takeInvitation,
  onCreateContact,
  saveEml
}: {
  message: MessageDetail
  canWrite: boolean
  inTrash: boolean
  /** S1: the whole message is being downloaded */
  downloading: boolean
  onCompose?: Compose
  /** A forward carries the files, so it downloads them first */
  forward: (compose: Compose) => Promise<void>
  onToggleFlag: (id: number, flagged: boolean) => void
  onMarkUnread?: (id: number) => void
  onArchive?: (id: number) => void
  /** #214: to Junk / back to the inbox; set only where it applies */
  onSpam?: (id: number) => void
  onNotSpam?: (id: number) => void
  onDelete: (id: number) => void
  onLink: () => void
  onCreateEvent: () => void
  /** #71: set only when the mail carries an invitation */
  takeInvitation?: () => Promise<void>
  onCreateContact: () => void
  saveEml: () => Promise<void>
}) {
  return (
    <div className="-ml-2 flex flex-wrap items-center gap-1 @xl:ml-0 @xl:shrink-0 @xl:flex-nowrap">
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
                onClick={() => void forward(onCompose)}
                disabled={downloading}
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
          {onSpam && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onSpam(message.id)}
              title="Spam"
              aria-label="Spam"
            >
              <ShieldAlert />
            </Button>
          )}
          {onNotSpam && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onNotSpam(message.id)}
              title="Kein Spam (zurück in den Posteingang)"
              aria-label="Kein Spam"
            >
              <ShieldCheck />
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
        onClick={onLink}
        disabled={!message.messageId}
        title={
          message.messageId ? 'Zuordnen…' : 'Zuordnen geht nicht: die Mail hat keine Message-ID'
        }
        aria-label="Zuordnen…"
      >
        <Tags />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onCreateEvent}
        disabled={!message.messageId}
        title={
          message.messageId
            ? 'Event aus dieser Mail anlegen'
            : 'Event anlegen geht nicht: die Mail hat keine Message-ID'
        }
        aria-label="Event aus dieser Mail anlegen"
      >
        <CalendarPlus />
      </Button>
      {takeInvitation && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void takeInvitation()}
          disabled={downloading}
          title="Einladung als Termin übernehmen"
          aria-label="Einladung als Termin übernehmen"
        >
          <CalendarCheck />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onCreateContact}
        disabled={!message.fromEmail}
        title="Absender als Kontakt anlegen"
        aria-label="Absender als Kontakt anlegen"
      >
        <UserPlus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void saveEml()}
        disabled={downloading}
        title="Original speichern (.eml)"
      >
        <Download />
      </Button>
    </div>
  )
}
