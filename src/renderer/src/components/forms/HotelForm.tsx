import { Separator } from '@/components/ui/separator'
import { FormFooter } from './FormActions'
import { FormBody } from './FormFields'
import { required, useAppForm } from './appForm'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import {
  addressDefaults,
  basicContactDefaults,
  optionalAddress,
  optionalContact
} from './formDefaults'
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
  const form = useAppForm({
    defaultValues: {
      name: initialData?.name ?? '',
      notes: initialData?.notes ?? '',
      address: addressDefaults(initialData?.address),
      contact: basicContactDefaults(initialData?.contact)
    },
    onSubmit: async ({ value }) => {
      const basePayload = {
        name: value.name.trim(),
        notes: value.notes.trim(),
        ...optionalAddress(value.address),
        ...optionalContact(value.contact)
      }

      if (mode === 'edit' && initialData) {
        onSubmit({ id: initialData.id, ...basePayload })
        return
      }

      onSubmit(basePayload)
    }
  })

  return (
    <FormBody form={form} disabled={isSubmitting}>
      <form.AppField name="name" validators={{ onChange: required('Name') }}>
        {(field) => <field.TextField label="Name" required placeholder="Hotelnamen eingeben" />}
      </form.AppField>

      <form.AppField name="notes">
        {(field) => (
          <field.TextareaField
            label="Anmerkungen"
            placeholder="Weitere Details zu diesem Hotel"
            rows={4}
          />
        )}
      </form.AppField>

      <Separator />
      <AddressFormFields form={form} />

      <Separator />
      <ContactFormFields form={form} showOtherEmails={false} />

      <FormFooter onCancel={onCancel} submitting={isSubmitting}>
        {mode === 'create' ? 'Hotel anlegen' : 'Änderungen speichern'}
      </FormFooter>
    </FormBody>
  )
}
