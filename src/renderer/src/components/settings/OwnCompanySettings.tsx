import { CircleAlert, CircleCheck, Pencil, Plus } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { CompanyDto } from '../../../../main/api/schemas/company.schema'
import { ownCompanyGaps } from './ownCompanyGaps'

/**
 * Einstellungen › Allgemein › "Eigene Firma": the company that issues invoices and represents
 * bands without their own management. Picked from the companies, or created and edited right
 * here with the same form as under "Firmen" - name, address, contact, tax ids, register, logo,
 * signature and bank, i.e. everything an invoice prints. Below, what an invoice still lacks.
 */
export function OwnCompanySettings() {
  const utils = trpcReact.useUtils()
  const companies = trpcReact.company.getListItems.useQuery()
  const own = trpcReact.company.getDefaultForInvoicing.useQuery()
  const sheet = useFormSheet<CompanyDto>()

  const saved = (message: string) => {
    void utils.company.invalidate()
    sheet.close()
    toast.success(message)
  }
  const failed = (error: { message: string }) =>
    toast.error('Eigene Firma konnte nicht gespeichert werden', { description: error.message })

  const setDefault = trpcReact.company.setDefaultForInvoicing.useMutation({
    onSuccess: () => {
      void utils.company.invalidate()
      toast.success('Eigene Firma gespeichert')
    },
    onError: failed
  })
  const create = trpcReact.company.create.useMutation({
    onSuccess: () => saved('Eigene Firma angelegt'),
    onError: failed
  })
  const update = trpcReact.company.update.useMutation({
    onSuccess: () => saved('Eigene Firma gespeichert'),
    onError: failed
  })

  const company = own.data ?? null
  const gaps = company ? ownCompanyGaps(company) : []

  return (
    <div className="space-y-2 md:col-span-2">
      <Label htmlFor="settings-own-company">Eigene Firma</Label>
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          id="settings-own-company"
          className="min-w-64 flex-1 md:max-w-md"
          value={company?.id ?? null}
          onChange={(value) => setDefault.mutate(value)}
          options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          noneLabel="Keine"
          searchPlaceholder="Firma suchen…"
          disabled={own.isLoading || setDefault.isPending}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!company}
          aria-label="Eigene Firma bearbeiten"
          onClick={() => company && sheet.openEdit(company)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Bearbeiten
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Eigene Firma neu anlegen"
          onClick={sheet.openCreate}
        >
          <Plus className="h-3.5 w-3.5" />
          Neu anlegen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Stellt Rechnungen aus und vertritt Bands ohne eigenes Management in Verträgen. Ihre Daten,
        das Logo und die Bankverbindung stehen auf jeder Rechnung.
      </p>
      {company &&
        (gaps.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck className="h-3.5 w-3.5 text-green-600" aria-hidden />
            Alles da, was auf einer Rechnung steht.
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Für Rechnungen fehlt noch: {gaps.join(', ')}.
          </p>
        ))}

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode={sheet.mode}
        title={sheet.mode === 'create' ? 'Eigene Firma anlegen' : 'Eigene Firma bearbeiten'}
        description={
          sheet.mode === 'create'
            ? 'Wird nach dem Speichern als eigene Firma gesetzt.'
            : 'Diese Angaben stehen auf Rechnungen und Verträgen.'
        }
      >
        <CompanyForm
          company={sheet.mode === 'edit' ? (sheet.selectedItem ?? undefined) : undefined}
          onSubmit={(data) => {
            if (data.id != null) update.mutate({ ...data, id: data.id })
            else create.mutate({ ...data, isDefaultForInvoicing: true })
          }}
          onCancel={sheet.close}
          isSubmitting={create.isPending || update.isPending}
        />
      </FormSheet>
    </div>
  )
}
