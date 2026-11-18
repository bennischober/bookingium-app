import { useState } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PRODUCT_NAMES } from '../../../../main/api/terms'
import {
  DATEV_CATEGORY_LABELS,
  DatevCategory,
  type DatevUploadEmails
} from '../../../../main/api/schemas/datev.schema'

const EMPTY: DatevUploadEmails = {
  outgoing: '',
  incoming: '',
  cash: '',
  other: '',
  credit_card: ''
}

/**
 * The DATEV Upload Mail addresses per issuing company (Einstellungen › Rechnungen). Each company
 * is its own client (Mandant) in DATEV Unternehmen online, and DATEV gives it one upload address
 * per document category; a document is filed by the address it arrives at. "An DATEV übergeben"
 * on an invoice mails its PDF to the category picked there, Rechnungsausgang by default.
 */
export function DatevCard() {
  const utils = trpcReact.useUtils()
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [addresses, setAddresses] = useState<DatevUploadEmails>(EMPTY)
  const [saving, setSaving] = useState(false)

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

  // Keep the inputs following the loaded addresses (per company)
  const loaded = settingsQuery.isSuccess
    ? (settingsQuery.data?.datevUploadEmails ?? EMPTY)
    : undefined
  const [lastLoaded, setLastLoaded] = useState<DatevUploadEmails | undefined>(loaded)
  if (loaded !== lastLoaded) {
    setLastLoaded(loaded)
    setAddresses(loaded ?? EMPTY)
  }

  const save = trpcReact.datev.setUploadEmail.useMutation()

  const handleSave = async () => {
    if (companyId === null) {
      toast.error('Bitte zuerst eine Firma auswählen')
      return
    }
    const changed = DatevCategory.options.filter(
      (category) => addresses[category].trim() !== (loaded ?? EMPTY)[category]
    )
    if (changed.length === 0) {
      toast.success('DATEV-Adressen gespeichert')
      return
    }
    setSaving(true)
    try {
      for (const category of changed) {
        await save.mutateAsync({
          companyId,
          category,
          datevUploadEmail: addresses[category].trim()
        })
      }
      toast.success('DATEV-Adressen gespeichert')
    } catch (error) {
      toast.error('DATEV-Adressen konnten nicht gespeichert werden', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      void utils.invoice.getCompanySettings.invalidate(companyId)
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>DATEV</CardTitle>
        <CardDescription>
          {PRODUCT_NAMES.datevOnline} gibt jeder Firma eine Upload-Mail-Adresse pro Belegkategorie
          und legt einen Beleg nach der Adresse ab, an die er geht. „An DATEV übergeben“ schickt das
          Rechnungs-PDF an die dort gewählte Kategorie, sonst an Rechnungsausgang. Gesendet wird vom
          Konto unter E-Mail › „Senden von“ – diese Absenderadresse muss in DATEV Upload Mail
          freigegeben sein.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 sm:max-w-md">
          <Label htmlFor="datev-company">Firma (DATEV-Mandant)</Label>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DatevCategory.options.map((category) => (
            <div key={category} className="space-y-2">
              <Label htmlFor={`datev-address-${category}`}>{DATEV_CATEGORY_LABELS[category]}</Label>
              <Input
                id={`datev-address-${category}`}
                type="email"
                placeholder={`Adresse aus ${PRODUCT_NAMES.datevOnline}`}
                value={addresses[category]}
                onChange={(e) => setAddresses({ ...addresses, [category]: e.target.value })}
                disabled={companyId === null || settingsQuery.isLoading}
              />
            </div>
          ))}
        </div>

        <Button onClick={() => void handleSave()} disabled={saving || companyId === null}>
          Speichern
        </Button>
      </CardContent>
    </Card>
  )
}
