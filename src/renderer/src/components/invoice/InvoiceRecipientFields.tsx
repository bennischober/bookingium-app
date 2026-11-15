import { SearchableSelect } from '@/components/ui/searchable-select'
import { InfoLabel } from '@/components/InfoLabel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { trpcReact } from '@/lib/trpc'
import {
  INVOICE_RECIPIENT_KINDS,
  RECIPIENT_KIND_LABELS,
  recipientOfKind,
  type RecipientDraft
} from '@/components/invoice/invoiceFormState'
import type { InvoiceRecipientKind } from '../../../../main/api/schemas/invoice.schema'

/**
 * Who receives the invoice: the kind, then the company, band or person of
 * that kind, or a typed name for "Sonstige".
 */
export function InvoiceRecipientFields({
  recipient,
  onChange
}: {
  recipient: RecipientDraft
  onChange: (recipient: RecipientDraft) => void
}) {
  const companies = trpcReact.company.getListItems.useQuery()
  const bands = trpcReact.band.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const set = (patch: Partial<RecipientDraft>) => onChange({ ...recipient, ...patch })

  return (
    <>
      <div className="space-y-2">
        <InfoLabel text="Rechnungsempfänger" info="Wer wird belastet? Zahlt diese Rechnung." />
        <Select
          value={recipient.kind}
          onValueChange={(value) => onChange(recipientOfKind(value as InvoiceRecipientKind))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVOICE_RECIPIENT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {RECIPIENT_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {recipient.kind === 'company' && (
        <div className="space-y-2">
          <Label htmlFor="invoice-recipient-company">Empfänger-Firma</Label>
          <SearchableSelect
            id="invoice-recipient-company"
            value={recipient.companyId}
            onChange={(companyId) => set({ companyId })}
            options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            noneLabel="Automatisch"
            searchPlaceholder="Firma suchen…"
          />
        </div>
      )}

      {recipient.kind === 'band' && (
        <div className="space-y-2">
          <Label htmlFor="invoice-recipient-band">Empfänger-Band</Label>
          <SearchableSelect
            id="invoice-recipient-band"
            value={recipient.bandId}
            onChange={(bandId) => set({ bandId })}
            options={(bands.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
            placeholder="Band auswählen"
            searchPlaceholder="Band suchen…"
          />
        </div>
      )}

      {recipient.kind === 'person' && (
        <div className="space-y-2">
          <Label htmlFor="invoice-recipient-person">Empfänger-Person</Label>
          <SearchableSelect
            id="invoice-recipient-person"
            value={recipient.personId}
            onChange={(personId) => set({ personId })}
            options={(persons.data ?? []).map((p) => ({
              value: p.id,
              label: `${p.firstName} ${p.lastName}`.trim()
            }))}
            placeholder="Person auswählen"
            searchPlaceholder="Person suchen…"
          />
        </div>
      )}

      {recipient.kind === 'other' && (
        <div className="space-y-2">
          <Label>Empfängername</Label>
          <Input
            value={recipient.nameOverride}
            onChange={(e) => set({ nameOverride: e.target.value })}
            placeholder="Empfängername eingeben"
          />
        </div>
      )}
    </>
  )
}
