import { Separator } from '@/components/ui/separator'
import { FormFooter } from './FormActions'
import { FormBody } from './FormFields'
import { useAppForm } from './appForm'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { addressDefaults, contactDefaults } from './formDefaults'
import type { z } from 'zod'
import type { CreatePersonInput, PersonDto } from '../../../../main/api/schemas/person.schema'
import { t } from '../../../../main/i18n/translate'

interface PersonFormProps {
  person?: PersonDto
  onSubmit: (data: z.infer<typeof CreatePersonInput> & { id?: number }) => void
  onCancel: () => void
  // Create mode only: values a new person starts with (a mail's sender, say)
  prefill?: { firstName?: string; lastName?: string; email?: string }
}

export function PersonForm({ person, onSubmit, onCancel, prefill }: PersonFormProps) {
  const form = useAppForm({
    defaultValues: {
      firstName: person?.firstName || prefill?.firstName || '',
      lastName: person?.lastName || prefill?.lastName || '',
      birthday: person?.birthday || null,
      notes: person?.notes || '',
      address: addressDefaults(person?.address),
      contact: {
        ...contactDefaults(person?.contact),
        email: person?.contact?.email || prefill?.email || ''
      }
    },
    onSubmit: async ({ value }) => {
      onSubmit(person ? { ...value, id: person.id } : value)
    }
  })

  return (
    <FormBody form={form}>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('Persönliche Angaben')}</h3>

        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="firstName">
            {(field) => <field.TextField label={t('Vorname')} required />}
          </form.AppField>
          <form.AppField name="lastName">
            {(field) => <field.TextField label={t('Nachname')} required />}
          </form.AppField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="birthday">
            {(field) => <field.TextField label={t('Geburtstag')} type="date" nullIfEmpty />}
          </form.AppField>
        </div>

        <form.AppField name="notes">
          {(field) => <field.TextareaField label={t('Anmerkungen')} rows={3} />}
        </form.AppField>
      </div>

      <Separator />

      <AddressFormFields form={form} />

      <Separator />

      <ContactFormFields form={form} showNoAdvertising />

      <FormFooter onCancel={onCancel}>{person ? t('Speichern') : t('Anlegen')}</FormFooter>
    </FormBody>
  )
}
