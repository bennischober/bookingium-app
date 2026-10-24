import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ArrowLeft, Ban, BellRing, Lock, Mail, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { InvoiceStatusBadge } from '@/components/invoice/InvoiceStatusBadge'
import { EInvoiceStatus } from '@/components/invoice/EInvoiceStatus'
import { InvoiceMailsCard } from '@/components/invoice/InvoiceMailsCard'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Empty, Fields, InfoCard } from '@/components/detail/DetailParts'
import { confirmAction } from '@/lib/confirm'
import { formatShortDate } from '@/lib/utils'
import { useInvalidateInvoices } from '@/hooks/useInvalidateInvoices'
import { invoiceHistory } from '@/lib/invoiceHistory'
import { localIsoDate } from '@/lib/followUps'
import {
  INVOICE_STATUS_LABELS,
  REMINDER_ACTION_LABELS,
  formatMoney,
  invoiceFollowUpName,
  invoiceMomentLabel,
  invoiceNumberLabel
} from '@/lib/invoiceLabels'
import {
  isInvoiceLocked,
  nextInvoiceStatuses,
  nextReminderKind,
  type InvoiceDto,
  type InvoiceStatus
} from '../../../main/api/schemas/invoice.schema'

const STATUS_ACTION_LABELS: Partial<Record<InvoiceStatus, string>> = {
  issued: 'Wieder offen (gestellt)',
  paid: 'Als bezahlt markieren',
  overdue: 'Als überfällig markieren'
}

function invoiceTitle(invoice: Pick<InvoiceDto, 'kind' | 'invoiceNumber'>) {
  const noun = invoice.kind === 'cancellation' ? 'Stornorechnung' : 'Rechnung'
  return `${noun} ${invoiceNumberLabel(invoice.invoiceNumber)}`
}

/**
 * Page of an issued invoice: what it says, its Verlauf (status changes,
 * emails), the e-invoice check and the status changes it still allows,
 * including Storno. Drafts are edited in the sheet of the invoice list.
 */
export default function InvoiceDetailPage() {
  const { invoiceId } = useParams({ strict: false }) as { invoiceId?: string }
  const id = Number(invoiceId)
  const navigate = useNavigate()
  const invoiceQuery = trpcReact.invoice.getById.useQuery(id, {
    enabled: Number.isInteger(id) && id > 0
  })
  const invoice = invoiceQuery.data

  // A draft has no page; it opens in the sheet
  const draft = invoice !== undefined && invoice !== null && !isInvoiceLocked(invoice.status)
  useEffect(() => {
    if (draft) void navigate({ to: '/invoices', search: { open: id }, replace: true })
  }, [draft, id, navigate])

  if (invoiceQuery.isLoading || draft) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Rechnung wird geladen…</p>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Rechnung nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
          Zurück zu den Rechnungen
        </Button>
      </div>
    )
  }

  const record = { type: 'invoice', id: invoice.id, name: invoiceFollowUpName(invoice) } as const
  // The email is created on the print page, from the template chosen there
  const toPrint = () =>
    navigate({ to: '/invoices/$invoiceId/print', params: { invoiceId: String(invoice.id) } })
  // Overdue: the Zahlungserinnerung, after it a Mahnung (sent from the print page too)
  const reminder = nextReminderKind(invoice, localIsoDate())

  return (
    <div className="flex h-full w-full min-w-0 flex-col p-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate({ to: '/invoices' })}
        >
          <ArrowLeft className="h-4 w-4" />
          Alle Rechnungen
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{invoiceTitle(invoice)}</h1>
              <InvoiceStatusBadge
                status={invoice.status}
                kind={invoice.kind}
                cancelsInvoiceNumber={invoice.cancelsInvoiceNumber}
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                invoice.recipientName && `An ${invoice.recipientName}`,
                formatMoney(invoice.totalGrossAmount, invoice.currency)
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="mt-1 flex shrink-0 flex-wrap items-center gap-2">
            <FollowUpButton record={record} />
            {reminder && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  navigate({
                    to: '/invoices/$invoiceId/print',
                    params: { invoiceId: String(invoice.id) },
                    search: { email: reminder }
                  })
                }
              >
                <BellRing className="h-3.5 w-3.5" />
                {REMINDER_ACTION_LABELS[reminder]}
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={toPrint}>
              <Mail className="h-3.5 w-3.5" />
              Per E-Mail senden…
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={toPrint}>
              <Printer className="h-3.5 w-3.5" />
              Drucken / PDF
            </Button>
          </div>
        </div>
      </div>

      <RecordFollowUps record={record} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <LockNotice invoice={invoice} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoCard label="Rechnung">
              <Fields
                fields={[
                  ['Rechnungssteller', invoice.companyName],
                  ['Rechnungsempfänger', invoice.recipientName],
                  ['Rechnungsdatum', formatShortDate(invoice.issueDate)],
                  ['Fällig', invoice.dueDate ? formatShortDate(invoice.dueDate) : null],
                  ['Zeitraum', invoice.periodLabel],
                  ['Käuferreferenz / Leitweg-ID', invoice.buyerReference]
                ]}
              />
            </InfoCard>
            <InfoCard label="Event">
              {invoice.dealMemoId && invoice.dealMemoName ? (
                <Link
                  to="/events/$eventId"
                  params={{ eventId: String(invoice.dealMemoId) }}
                  className="font-medium hover:underline"
                >
                  {invoice.dealMemoName}
                </Link>
              ) : (
                <Empty />
              )}
            </InfoCard>
          </div>
          <Positions invoice={invoice} />
          <EInvoiceCheck invoiceId={invoice.id} />
          <StatusActions invoice={invoice} />
        </div>
        <div className="min-w-0 space-y-4">
          <InvoiceMailsCard invoiceId={invoice.id} />
          <History invoice={invoice} />
        </div>
      </div>
    </div>
  )
}

function LockNotice({ invoice }: { invoice: InvoiceDto }) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p>
        {invoice.kind === 'cancellation'
          ? `Diese Stornorechnung gleicht Rechnung ${invoiceNumberLabel(invoice.cancelsInvoiceNumber)} aus. Sie bleibt, wie sie ist.`
          : invoice.status === 'cancelled'
            ? invoice.cancelledByInvoiceNumber
              ? `Diese Rechnung ist storniert. Sie bleibt mit ihrer Nummer erhalten; ausgeglichen wird sie durch die Stornorechnung ${invoiceNumberLabel(invoice.cancelledByInvoiceNumber)}.`
              : 'Diese Rechnung ist storniert. Sie bleibt mit ihrer Nummer erhalten.'
            : 'Diese Rechnung ist gestellt und kann nicht mehr geändert oder gelöscht werden. Für Korrekturen bitte stornieren und eine neue Rechnung anlegen.'}
      </p>
    </div>
  )
}

function Positions({ invoice }: { invoice: InvoiceDto }) {
  return (
    <InfoCard label="Positionen">
      <div className="space-y-1">
        {invoice.lineItems.map((line) => (
          <div key={line.id} className="flex justify-between gap-4">
            <span>
              {line.quantity} × {line.description}
            </span>
            <span className="tabular-nums">
              {formatMoney(line.lineNetAmount, invoice.currency)}
            </span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
          <span>Gesamt brutto</span>
          <span className="tabular-nums">
            {formatMoney(invoice.totalGrossAmount, invoice.currency)}
          </span>
        </div>
      </div>
    </InfoCard>
  )
}

function EInvoiceCheck({ invoiceId }: { invoiceId: number }) {
  const eInvoice = trpcReact.invoice.eInvoiceCheck.useQuery(invoiceId)
  return eInvoice.data ? <EInvoiceStatus check={eInvoice.data} /> : null
}

/** The status changes the invoice still allows, Storno last */
function StatusActions({ invoice }: { invoice: InvoiceDto }) {
  const navigate = useNavigate()
  const invalidateInvoices = useInvalidateInvoices()

  const statusMutation = trpcReact.invoice.setStatus.useMutation({
    onSuccess: (updated) => {
      invalidateInvoices()
      const stornoId = updated.cancelledByInvoiceId
      if (updated.status === 'cancelled' && stornoId) {
        toast.success(
          `Rechnung ${invoiceNumberLabel(updated.invoiceNumber)} storniert – Stornorechnung ${invoiceNumberLabel(updated.cancelledByInvoiceNumber)} erstellt`,
          {
            action: {
              label: 'Anzeigen',
              onClick: () =>
                navigate({ to: '/invoices/$invoiceId', params: { invoiceId: String(stornoId) } })
            }
          }
        )
        return
      }
      toast.success(
        updated.status === 'cancelled'
          ? `Rechnung ${invoiceNumberLabel(updated.invoiceNumber)} storniert`
          : `Status: ${INVOICE_STATUS_LABELS[updated.status]}`
      )
    },
    onError: (error) =>
      toast.error('Status konnte nicht geändert werden', { description: error.message })
  })

  const nextStatuses = nextInvoiceStatuses(invoice.status, invoice.kind)
  if (nextStatuses.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {nextStatuses
        .filter((status) => status !== 'cancelled')
        .map((status) => (
          <Button
            key={status}
            variant="outline"
            size="sm"
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate({ id: invoice.id, status })}
          >
            {STATUS_ACTION_LABELS[status] ?? INVOICE_STATUS_LABELS[status]}
          </Button>
        ))}
      {nextStatuses.includes('cancelled') && (
        <Button
          variant="destructive"
          size="sm"
          className="ml-auto"
          disabled={statusMutation.isPending}
          onClick={async () => {
            if (
              await confirmAction({
                title: `Rechnung ${invoiceNumberLabel(invoice.invoiceNumber)} stornieren?`,
                description:
                  'Die Rechnung bleibt mit ihrer Nummer erhalten. Eine Stornorechnung mit der nächsten Rechnungsnummer gleicht sie aus. Das lässt sich nicht rückgängig machen.',
                confirmLabel: 'Stornieren',
                destructive: true
              })
            ) {
              statusMutation.mutate({ id: invoice.id, status: 'cancelled' })
            }
          }}
        >
          <Ban className="h-4 w-4" /> Stornieren
        </Button>
      )}
    </div>
  )
}

/** Verlauf: created, status changes, emails – oldest first */
function History({ invoice }: { invoice: InvoiceDto }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Verlauf</h2>
      <ol aria-label="Verlauf" className="space-y-3 border-l pl-4">
        {invoiceHistory(invoice).map((entry, index) => (
          <li key={index} className="relative text-sm">
            <span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-muted-foreground/50" />
            <div className="font-medium">
              {entry.label}
              {entry.link && (
                <>
                  {' '}
                  <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: String(entry.link.invoiceId) }}
                    className="text-primary hover:underline"
                  >
                    {entry.link.label}
                  </Link>
                </>
              )}
            </div>
            <div className="text-muted-foreground">
              {invoiceMomentLabel(entry.at)}
              {entry.detail && ` · ${entry.detail}`}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
