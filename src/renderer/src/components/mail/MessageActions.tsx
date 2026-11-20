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
import { t } from '../../../../main/i18n/translate'

type Compose = (
  message: MessageDetail,
  kind: 'reply' | 'replyAll' | 'forward' | 'editAsNew'
) => void

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
                title={t('Antworten')}
                aria-label={t('Antworten')}
              >
                <Reply />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onCompose(message, 'replyAll')}
                title={t('Allen antworten')}
                aria-label={t('Allen antworten')}
              >
                <ReplyAll />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void forward(onCompose)}
                disabled={downloading}
                title={t('Weiterleiten')}
                aria-label={t('Weiterleiten')}
              >
                <Forward />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleFlag(message.id, !message.isFlagged)}
            title={message.isFlagged ? t('Markierung entfernen') : t('Markieren')}
            aria-pressed={message.isFlagged}
          >
            <Flag className={cn(message.isFlagged && 'fill-orange-500 text-orange-500')} />
          </Button>
          {onMarkUnread && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onMarkUnread(message.id)}
              title={t('Als ungelesen markieren')}
            >
              <Mail />
            </Button>
          )}
          {onArchive && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onArchive(message.id)}
              title={t('Archivieren')}
            >
              <Archive />
            </Button>
          )}
          {onSpam && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onSpam(message.id)}
              title={t('Spam')}
              aria-label={t('Spam')}
            >
              <ShieldAlert />
            </Button>
          )}
          {onNotSpam && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onNotSpam(message.id)}
              title={t('Kein Spam (zurück in den Posteingang)')}
              aria-label={t('Kein Spam')}
            >
              <ShieldCheck />
            </Button>
          )}
          {!inTrash && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(message.id)}
              title={t('In den Papierkorb (Entf)')}
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
          message.messageId
            ? t('Zuordnen…')
            : t('Zuordnen geht nicht: die Mail hat keine Message-ID')
        }
        aria-label={t('Zuordnen…')}
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
            ? t('Event aus dieser Mail anlegen')
            : t('Event anlegen geht nicht: die Mail hat keine Message-ID')
        }
        aria-label={t('Event aus dieser Mail anlegen')}
      >
        <CalendarPlus />
      </Button>
      {takeInvitation && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void takeInvitation()}
          disabled={downloading}
          title={t('Einladung als Termin übernehmen')}
          aria-label={t('Einladung als Termin übernehmen')}
        >
          <CalendarCheck />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onCreateContact}
        disabled={!message.fromEmail}
        title={t('Absender als Kontakt anlegen')}
        aria-label={t('Absender als Kontakt anlegen')}
      >
        <UserPlus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void saveEml()}
        disabled={downloading}
        title={t('Original speichern (.eml)')}
      >
        <Download />
      </Button>
    </div>
  )
}
