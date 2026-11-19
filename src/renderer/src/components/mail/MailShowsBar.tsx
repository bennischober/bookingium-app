import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ClipboardList, Ticket, UserRound } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { formatShortDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { soldOf } from '../../../../main/advancing/advancing'
import {
  ADVANCING_STATUS_LABELS,
  type MailShowDto
} from '../../../../main/api/schemas/advancing.schema'
import type { MessageDetail } from '../../../../main/mailclient/core/types'

const today = (): string => new Date().toISOString().slice(0, 10)

function ShowRow({ show, message }: { show: MailShowDto; message: MessageDetail }) {
  const utils = trpcReact.useUtils()
  const [sold, setSold] = useState(show.suggestedSold !== null ? String(show.suggestedSold) : '')
  const refresh = (): void => {
    void utils.advancing.invalidate()
  }
  const setStage = trpcReact.advancing.setStage.useMutation({
    onSuccess: (saved) => {
      refresh()
      toast.success(`Advancing: ${ADVANCING_STATUS_LABELS[saved.status]}`)
    },
    onError: (error) => toast.error('Advancing nicht gespeichert', { description: error.message })
  })
  const report = trpcReact.advancing.saveReport.useMutation({
    onSuccess: () => {
      refresh()
      setSold('')
      toast.success('Ticketmeldung gespeichert')
    },
    onError: (error) =>
      toast.error('Ticketmeldung nicht gespeichert', { description: error.message })
  })
  const contact = trpcReact.advancing.localContactFromMail.useMutation({
    onSuccess: () => {
      refresh()
      toast.success(`${message.fromName || message.fromEmail} ist Kontakt vor Ort`)
    },
    onError: (error) =>
      toast.error('Kontakt vor Ort nicht übernommen', { description: error.message })
  })
  const parsed = soldOf(sold)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 text-sm">
      <Link
        to="/events/$eventId"
        params={{ eventId: String(show.eventId) }}
        search={{ tab: 'advancing' }}
        className="min-w-0 font-medium hover:underline"
      >
        {formatShortDate(show.date)} · {show.label}
      </Link>
      <Badge variant="outline" className="gap-1 font-normal">
        <ClipboardList className="h-3 w-3" />
        {ADVANCING_STATUS_LABELS[show.status]}
      </Badge>
      {show.suggestedStatus && (
        <Button
          size="sm"
          variant="outline"
          disabled={setStage.isPending}
          onClick={() => setStage.mutate({ eventId: show.eventId, status: show.suggestedStatus! })}
        >
          → {ADVANCING_STATUS_LABELS[show.suggestedStatus]}
        </Button>
      )}
      {show.status !== 'done' && (
        <Button
          size="sm"
          variant="ghost"
          disabled={setStage.isPending}
          onClick={() => setStage.mutate({ eventId: show.eventId, status: 'done' })}
        >
          Abgeschlossen
        </Button>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (parsed !== null)
            report.mutate({ eventId: show.eventId, reportDate: today(), sold: parsed, note: '' })
        }}
      >
        <Ticket className="h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          className="h-8 w-20"
          inputMode="numeric"
          aria-label={`Tickets verkauft ${show.label}`}
          placeholder={show.sold !== null ? String(show.sold) : 'verkauft'}
          value={sold}
          onChange={(event) => setSold(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          type="submit"
          disabled={parsed === null || report.isPending}
        >
          Meldung
        </Button>
        {show.quota !== null && (
          <span className="text-xs text-muted-foreground">von {show.quota}</span>
        )}
      </form>
      {!show.senderIsLocalContact && message.fromEmail && (
        <Button
          size="sm"
          variant="ghost"
          disabled={contact.isPending}
          title={
            show.localContact
              ? `Ersetzt ${show.localContact.name} als Kontakt vor Ort`
              : 'Absender als Kontakt vor Ort der Show eintragen'
          }
          onClick={() =>
            contact.mutate({
              eventId: show.eventId,
              email: message.fromEmail,
              name: message.fromName
            })
          }
        >
          <UserRound className="h-4 w-4" /> Als Kontakt vor Ort
        </Button>
      )}
    </li>
  )
}

/**
 * #235: above a mail that belongs to shows - linked to them, or from or to their promoter, its
 * contact or the contact on site: the advancing stage to move on, a ticket count to report
 * (one the mail names is filled in), the sender as contact on site
 */
export function MailShowsBar({
  accountId,
  message
}: {
  accountId: string
  message: MessageDetail
}) {
  const shows = trpcReact.advancing.forMail.useQuery(
    {
      accountId,
      messageId: message.messageId,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: [...message.to, ...message.cc].map((address) => address.email).slice(0, 100),
      subject: message.subject.slice(0, 2000),
      snippet: message.snippet.slice(0, 5000)
    },
    { staleTime: 30_000 }
  )
  const list = shows.data ?? []
  if (list.length === 0) return null
  return (
    <section className="rounded-md border bg-muted/40 px-3 py-1" aria-label="Shows dieser E-Mail">
      <ul className="divide-y">
        {list.map((show) => (
          <ShowRow key={show.eventId} show={show} message={message} />
        ))}
      </ul>
    </section>
  )
}
