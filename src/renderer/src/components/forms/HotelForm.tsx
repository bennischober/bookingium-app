import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import type { FormMode } from '@/hooks/useFormSheet'
import type {
  CreateHotelInput,
  HotelDto,
  UpdateHotelInput
} from '../../../../main/api/schemas/hotel.schema'

interface HotelFormProps {
  mode: FormMode
  initialData?: HotelDto | null
  onSubmit: (data: CreateHotelInput | UpdateHotelInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function HotelForm({
  mode,
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false
}: HotelFormProps) {
  const form = useForm({
    defaultValues: {
      name: initialData?.name ?? '',
      notes: initialData?.notes ?? '',
      address: {
        street: initialData?.address?.street ?? '',
        streetNumber: initialData?.address?.streetNumber ?? '',
        addressSuffix: initialData?.address?.addressSuffix ?? '',
        zipCode: initialData?.address?.zipCode ?? '',
        city: initialData?.address?.city ?? '',
        state: initialData?.address?.state ?? '',
        country: initialData?.address?.country ?? '',
        countryCode: initialData?.address?.countryCode ?? ''
      },
      contact: {
        email: initialData?.contact?.email ?? '',
        phone: initialData?.contact?.phone ?? '',
        mobilePhone: initialData?.contact?.mobilePhone ?? '',
        homepage: initialData?.contact?.homepage ?? ''
      }
    },
    onSubmit: async ({ value }) => {
      const hasAddress = Object.values(value.address).some((entry) => entry.trim().length > 0)
      const hasContact = Object.values(value.contact).some((entry) => entry.trim().length > 0)
      const basePayload = {
        name: value.name.trim(),
        notes: value.notes.trim(),
        ...(hasAddress ? { address: value.address } : {}),
        ...(hasContact ? { contact: value.contact } : {})
      }

      if (mode === 'edit' && initialData) {
        onSubmit({ id: initialData.id, ...basePayload })
        return
      }

      onSubmit(basePayload)
    }
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-6"
    >
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => {
            if (!value || value.trim().length === 0) {
              return 'Name ist erforderlich'
            }
            return undefined
          }
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Hotelnamen eingeben"
              disabled={isSubmitting}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="notes">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Anmerkungen</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Weitere Details zu diesem Hotel"
              rows={4}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      <Separator />
      <AddressFormFields form={form} />

      <Separator />
      <ContactFormFields form={form} showOtherEmails={false} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Speichert…'
            : mode === 'create'
              ? 'Hotel anlegen'
              : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  )
}
