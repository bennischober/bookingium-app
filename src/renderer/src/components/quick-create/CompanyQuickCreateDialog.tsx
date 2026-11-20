import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuickCreateDialog } from '@/components/quick-create/QuickCreateDialog'
import { t } from '../../../../main/i18n/translate'

/**
 * A company with its name and city, opened from a Firma picker ("Neue Firma
 * anlegen") so a band or club form is no dead end without companies.
 */
export function CompanyQuickCreateDialog({
  isOpen,
  prefillName,
  onClose,
  onCreated
}: {
  isOpen: boolean
  prefillName: string
  onClose: () => void
  onCreated: (id: number, name: string) => void
}) {
  const [name, setName] = useState(prefillName)
  const [city, setCity] = useState('')
  const [openedWith, setOpenedWith] = useState<string | null>(null)
  const utils = trpcReact.useUtils()

  // Start from the typed search each time the dialog opens
  if (isOpen && openedWith !== prefillName) {
    setOpenedWith(prefillName)
    setName(prefillName)
    setCity('')
  }
  if (!isOpen && openedWith !== null) {
    setOpenedWith(null)
  }

  const createCompany = trpcReact.company.create.useMutation({
    onSuccess: (company) => {
      toast.success(t('„{{name}}“ angelegt', { name: company.name }))
      // The pickers and the company list
      void utils.company.invalidate()
      onCreated(company.id, company.name)
      onClose()
    },
    onError: (e) => toast.error(t('Firma konnte nicht angelegt werden'), { description: e.message })
  })

  const handleSubmit = () => {
    if (!name.trim()) return
    createCompany.mutate({
      name: name.trim(),
      ...(city.trim() ? { address: { city: city.trim() } } : {})
    })
  }

  return (
    <QuickCreateDialog
      isOpen={isOpen}
      title={t('Neue Firma anlegen')}
      submitLabel={t('Anlegen')}
      submitDisabled={!name.trim() || createCompany.isPending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="space-y-2">
        <Label htmlFor="company-quick-name">{t('Firmenname *')}</Label>
        <Input
          id="company-quick-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('z. B. Muster Booking GmbH')}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="company-quick-city">{t('Stadt')}</Label>
        <Input
          id="company-quick-city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={t('z. B. Berlin')}
        />
      </div>
    </QuickCreateDialog>
  )
}
