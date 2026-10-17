import { useNavigate } from '@tanstack/react-router'
import { Ban, Lock, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { FormSheet } from '@/components/form-sheet'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  formatMoney,
  invoiceNumberLabel
} from '@/lib/invoiceLabels'
import {
  isInvoiceLocked,
  nextInvoiceStatuses,
  type InvoiceDto,
  type InvoiceStatus
} from '../../../../main/api/schemas/invoice.schema'
import { confirmAction } from '@/lib/confirm'

const STATUS_ACTION_LABELS: Partial<Record<InvoiceStatus, string>> = {
  issued: 'Wieder offen (gestellt)',
  paid: 'Als bezahlt markieren',
  overdue: 'Als überfällig markieren'
}

/** Refreshes every view that shows invoices (lists, event, dashboard) */
function useInvalidateInvoices() {
  const utils = trpcReact.useUtils()
  return () => {
    void utils.invoice.invalidate()
    void utils.dealMemo.getById.invalidate()
    void utils.dashboard.invalidate()
  }
}

/**
 * Sheet for an existing invoice. Drafts open in the full form (where they
 * can also be issued); issued invoices are locked and show a read-only
 * summary with the allowed status changes, including Storno.
 */
export function InvoiceEditSheet({
  invoiceId,
  onClose
}: {
  invoiceId: number | null
  onClose: () => void
}) {
  const invalidateInvoices = useInvalidateInvoices()
  const invoiceQuery = trpcReact.invoice.getById.useQuery(invoiceId ?? 0, {
    enabled: invoiceId !== null
  })
  const invoice = invoiceId !== null ? invoiceQuery.data : undefined
  const locked = invoice ? isInvoiceLocked(invoice.status) : false

  const updateMutation = trpcReact.invoice.update.useMutation({
    onSuccess: (updated) => {
      invalidateInvoices()
      onClose()
      toast.success(
        updated.status === 'draft'
          ? 'Entwurf gespeichert'
          : `Rechnung ${invoiceNumberLabel(updated.invoiceNumber)} gestellt`
      )
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht gespeichert werden', { description: error.message })
  })

  return (
    <FormSheet
      isOpen={invoiceId !== null}
      onClose={onClose}
      mode="edit"
      title={
        !invoice
          ? 'Rechnung'
          : locked
            ? `Rechnung ${invoiceNumberLabel(invoice.invoiceNumber)}`
            : 'Entwurf bearbeiten'
      }
      description={
        locked
          ? 'Gestellte Rechnungen sind gesperrt. Nur der Status lässt sich noch ändern.'
          : 'Bearbeiten Sie Details, Empfänger, Verknüpfung und Positionen des Entwurfs.'
      }
    >
      {!invoice ? (
        <p className="text-sm text-muted-foreground">
          {invoiceQuery.isError ? 'Rechnung nicht gefunden.' : 'Rechnung wird geladen…'}
        </p>
      ) : locked ? (
        <LockedInvoicePanel invoice={invoice} onClose={onClose} />
      ) : (
        <InvoiceForm
          key={`edit-${invoice.id}`}
          mode="edit"
          invoice={invoice}
          onCancel={onClose}
          onCreate={() => {}}
          onUpdate={(payload) => updateMutation.mutate(payload)}
          isSubmitting={updateMutation.isPending}
        />
      )}
    </FormSheet>
  )
}

function LockedInvoicePanel({ invoice, onClose }: { invoice: InvoiceDto; onClose: () => void }) {
  const navigate = useNavigate()
  const invalidateInvoices = useInvalidateInvoices()

  const statusMutation = trpcReact.invoice.setStatus.useMutation({
    onSuccess: (updated) => {
      invalidateInvoices()
      toast.success(
        updated.status === 'cancelled'
          ? `Rechnung ${invoiceNumberLabel(updated.invoiceNumber)} storniert`
          : `Status: ${INVOICE_STATUS_LABELS[updated.status]}`
      )
    },
    onError: (error) =>
      toast.error('Status konnte nicht geändert werden', { description: error.message })
  })

  const nextStatuses = nextInvoiceStatuses(invoice.status)
  const canCancel = nextStatuses.includes('cancelled')

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p>
          {invoice.status === 'cancelled'
            ? 'Diese Rechnung ist storniert. Sie bleibt mit ihrer Nummer erhalten.'
            : 'Diese Rechnung ist gestellt und kann nicht mehr geändert oder gelöscht werden. Für Korrekturen bitte stornieren und eine neue Rechnung anlegen.'}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field label="Rechnungsnummer" value={invoiceNumberLabel(invoice.invoiceNumber)} />
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-0.5">
            <Badge variant="outline" className={INVOICE_STATUS_STYLES[invoice.status]}>
              {INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
          </dd>
        </div>
        <Field label="Rechnungssteller" value={invoice.companyName} />
        <Field label="Rechnungsempfänger" value={invoice.recipientName} />
        <Field label="Rechnungsdatum" value={invoice.issueDate} />
        <Field label="Fällig am" value={invoice.dueDate ?? '-'} />
        <Field label="Zeitraum" value={invoice.periodLabel || '-'} />
        <Field label="Event" value={invoice.dealMemoName ?? '-'} />
      </dl>

      <Separator />

      <div className="space-y-1 text-sm">
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

      {nextStatuses.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-wrap gap-2">
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
            {canCancel && (
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
                        'Die Rechnung bleibt mit ihrer Nummer erhalten. Das lässt sich nicht rückgängig machen.',
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
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() =>
            navigate({
              to: '/invoices/$invoiceId/print',
              params: { invoiceId: String(invoice.id) }
            })
          }
        >
          <Printer className="h-4 w-4" /> Drucken / PDF
        </Button>
        <Button onClick={onClose}>Schließen</Button>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}
