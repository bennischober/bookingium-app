import { useState } from 'react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

/** Next invoice number per issuing company (Einstellungen › Rechnungen) */
export function InvoiceNumberingCard() {
  const utils = trpcReact.useUtils()
  const [settingsCompanyId, setSettingsCompanyId] = useState<number | null>(null)
  const [nextNumberInput, setNextNumberInput] = useState('1')

  const companies = trpcReact.company.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()

  // Default to the default invoicing company once known (state adjustment
  // during render, per "You Might Not Need an Effect")
  const [lastDefaultCompanyId, setLastDefaultCompanyId] = useState<number | null | undefined>(
    defaultCompany.data?.id
  )
  if (settingsCompanyId === null && defaultCompany.data?.id !== lastDefaultCompanyId) {
    setLastDefaultCompanyId(defaultCompany.data?.id)
    if (defaultCompany.data?.id) {
      setSettingsCompanyId(defaultCompany.data.id)
    }
  }

  const settingsQuery = trpcReact.invoice.getCompanySettings.useQuery(settingsCompanyId ?? 0, {
    enabled: settingsCompanyId !== null
  })

  // Keep the input following the loaded settings
  const [lastNextInvoiceNumber, setLastNextInvoiceNumber] = useState<number | undefined>(
    settingsQuery.data?.nextInvoiceNumber
  )
  if (settingsQuery.data?.nextInvoiceNumber !== lastNextInvoiceNumber) {
    setLastNextInvoiceNumber(settingsQuery.data?.nextInvoiceNumber)
    setNextNumberInput((settingsQuery.data?.nextInvoiceNumber ?? 1).toString())
  }

  const settingsMutation = trpcReact.invoice.upsertCompanySettings.useMutation({
    onSuccess: () => {
      if (settingsCompanyId !== null) {
        utils.invoice.getCompanySettings.invalidate(settingsCompanyId)
      }
      toast.success('Rechnungsnummerierung aktualisiert')
    },
    onError: (error) =>
      toast.error('Einstellungen konnten nicht aktualisiert werden', { description: error.message })
  })

  const handleSave = () => {
    if (settingsCompanyId === null) {
      toast.error('Bitte zuerst eine Firma auswählen')
      return
    }
    const value = Number(nextNumberInput)
    if (!Number.isInteger(value) || value < 1) {
      toast.error('Nächste Rechnungsnummer muss eine ganze Zahl ≥ 1 sein')
      return
    }
    settingsMutation.mutate({ companyId: settingsCompanyId, nextInvoiceNumber: value })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rechnungsnummerierung</CardTitle>
        <CardDescription>
          Nummer, die die nächste gestellte Rechnung der gewählten Firma erhält.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <div className="space-y-2">
          <Label htmlFor="numbering-company">Firma</Label>
          <Select
            value={settingsCompanyId?.toString() ?? ''}
            onValueChange={(value) => setSettingsCompanyId(Number(value))}
          >
            <SelectTrigger id="numbering-company">
              <SelectValue placeholder="Firma auswählen" />
            </SelectTrigger>
            <SelectContent>
              {(companies.data ?? []).map((company) => (
                <SelectItem key={company.id} value={company.id.toString()}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="numbering-next">Nächste Rechnungsnummer</Label>
          <Input
            id="numbering-next"
            type="number"
            min="1"
            step="1"
            value={nextNumberInput}
            onChange={(e) => setNextNumberInput(e.target.value)}
            disabled={settingsQuery.isLoading}
          />
        </div>

        <Button onClick={handleSave} disabled={settingsMutation.isPending}>
          Speichern
        </Button>
      </CardContent>
    </Card>
  )
}
