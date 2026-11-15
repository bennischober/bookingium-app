import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuickCreateDialog } from '@/components/quick-create/QuickCreateDialog'

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
      toast.success(`"${venue.name}" angelegt`)
      onCreated(venue.id, venue.name)
      onClose()
    },
    onError: (e) =>
      toast.error('Club / Festival konnte nicht angelegt werden', { description: e.message })
  })

  const handleSubmit = () => {
    if (!name.trim()) return
    createVenue.mutate({ name: name.trim(), notes: city ? `Stadt: ${city}` : '' })
  }

  if (isOpen && name !== prefillName && prefillName) {
    setName(prefillName)
  }

  return (
    <QuickCreateDialog
      isOpen={isOpen}
      title="Neuen Club / Festival anlegen"
      submitLabel="Anlegen"
      submitDisabled={!name.trim() || createVenue.isPending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="space-y-2">
        <Label htmlFor="venue-name">Name *</Label>
        <Input
          id="venue-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Zenith München"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="venue-city">Stadt</Label>
        <Input
          id="venue-city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="z. B. Berlin"
        />
      </div>
    </QuickCreateDialog>
  )
}
