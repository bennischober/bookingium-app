import { useState } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PRODUCT_NAMES } from '../../../../main/api/terms'

/**
 * The DATEV Upload Mail address per issuing company (Einstellungen › Rechnungen). Each company
 * is its own client (Mandant) in DATEV Unternehmen online, with its own upload address;
 * "An DATEV übergeben" on an invoice mails its PDF there.
 */
export function DatevCard() {
  const utils = trpcReact.useUtils()
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [address, setAddress] = useState('')

  const companies = trpcReact.company.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()

  // Default to the default invoicing company once known (state adjustment during render)
  const [lastDefaultCompanyId, setLastDefaultCompanyId] = useState<number | null | undefined>(
    defaultCompany.data?.id
  )
  if (companyId === null && defaultCompany.data?.id !== lastDefaultCompanyId) {
    setLastDefaultCompanyId(defaultCompany.data?.id)
    if (defaultCompany.data?.id) setCompanyId(defaultCompany.data.id)
  }

  const settingsQuery = trpcReact.invoice.getCompanySettings.useQuery(companyId ?? 0, {
    enabled: companyId !== null
  })

  // Keep the input following the loaded address (per company)
  const loaded = settingsQuery.isSuccess ? (settingsQuery.data?.datevUploadEmail ?? '') : undefined
  const [lastLoaded, setLastLoaded] = useState<string | undefined>(loaded)
  if (loaded !== lastLoaded) {
    setLastLoaded(loaded)
    setAddress(loaded ?? '')
  }

  const save = trpcReact.datev.setUploadEmail.useMutation({
    onSuccess: () => {
      if (companyId !== null) void utils.invoice.getCompanySettings.invalidate(companyId)
      toast.success('DATEV-Adresse gespeichert')
    },
    onError: (error) =>
      toast.error('DATEV-Adresse konnte nicht gespeichert werden', { description: error.message })
  })

  const handleSave = () => {
    if (companyId === null) {
      toast.error('Bitte zuerst eine Firma auswählen')
      return
    }
    save.mutate({ companyId, datevUploadEmail: address.trim() })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>DATEV</CardTitle>
        <CardDescription>
          „An DATEV übergeben“ schickt das Rechnungs-PDF an die Upload-Mail-Adresse der Firma in{' '}
          {PRODUCT_NAMES.datevOnline}. Gesendet wird vom Konto unter E-Mail › „Senden von“ – diese
          Absenderadresse muss in DATEV Upload Mail freigegeben sein.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label htmlFor="datev-company">Firma</Label>
          <SearchableSelect
            id="datev-company"
            value={companyId}
            onChange={(value) => value !== null && setCompanyId(value)}
            options={(companies.data ?? []).map((company) => ({
              value: company.id,
              label: company.name
            }))}
            placeholder="Firma auswählen"
            searchPlaceholder="Firma suchen…"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="datev-address">Upload-Mail-Adresse</Label>
          <Input
            id="datev-address"
            type="email"
            placeholder={`Adresse aus ${PRODUCT_NAMES.datevOnline}`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={companyId === null || settingsQuery.isLoading}
          />
        </div>

        <Button onClick={handleSave} disabled={save.isPending || companyId === null}>
          Speichern
        </Button>
      </CardContent>
    </Card>
  )
}
