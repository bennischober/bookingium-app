import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuickCreateDialog } from '@/components/quick-create/QuickCreateDialog'
import { t } from '../../../../main/i18n/translate'

/** A club or festival with its name; the city goes into the notes */
export function VenueQuickCreateDialog({
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

  const createVenue = trpcReact.venue.create.useMutation({
    onSuccess: (venue) => {
      toast.success(t('"{{name}}" angelegt', { name: venue.name }))
      onCreated(venue.id, venue.name)
      onClose()
    },
    onError: (e) =>
      toast.error(t('Club / Festival konnte nicht angelegt werden'), { description: e.message })
  })

  const handleSubmit = () => {
    if (!name.trim()) return
    createVenue.mutate({ name: name.trim(), notes: city ? t('Stadt: {{city}}', { city }) : '' })
  }

  if (isOpen && name !== prefillName && prefillName) {
    setName(prefillName)
  }

  return (
    <QuickCreateDialog
      isOpen={isOpen}
      title={t('Neuen Club / Festival anlegen')}
      submitLabel={t('Anlegen')}
      submitDisabled={!name.trim() || createVenue.isPending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="space-y-2">
        <Label htmlFor="venue-name">{t('Name *')}</Label>
        <Input
          id="venue-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('z. B. Zenith München')}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="venue-city">{t('Stadt')}</Label>
        <Input
          id="venue-city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={t('z. B. Berlin')}
        />
      </div>
    </QuickCreateDialog>
  )
}
