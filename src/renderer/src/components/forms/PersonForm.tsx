import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { PersonDto } from 'src/main/api/schemas/person.schema'

interface PersonFormProps {
  person?: PersonDto
  onSubmit: (data: any) => void
  onCancel: () => void
}

export function PersonForm({ person, onSubmit, onCancel }: PersonFormProps) {
  const form = useForm({
    defaultValues: {
      firstName: person?.firstName || '',
      lastName: person?.lastName || '',
      birthday: person?.birthday || null,
      notes: person?.notes || '',
      address: {
        street: person?.address?.street || '',
        streetNumber: person?.address?.streetNumber || '',
        addressSuffix: person?.address?.addressSuffix || '',
        zipCode: person?.address?.zipCode || '',
        city: person?.address?.city || '',
        state: person?.address?.state || '',
        country: person?.address?.country || '',
        countryCode: person?.address?.countryCode || ''
      },
      contact: {
        email: person?.contact?.email || '',
        phone: person?.contact?.phone || '',
        mobilePhone: person?.contact?.mobilePhone || '',
        homepage: person?.contact?.homepage || ''
      }
    },
    onSubmit: async ({ value }) => {
      onSubmit(person ? { ...value, id: person.id } : value)
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
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Persönliche Angaben</h3>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="firstName">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="firstName">Vorname *</Label>
                <Input
                  id="firstName"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="lastName">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="lastName">Nachname *</Label>
                <Input
                  id="lastName"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
                )}
              </div>
            )}
          </form.Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="birthday">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="birthday">Geburtstag</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={field.state.value || ''}
                  onChange={(e) => field.handleChange(e.target.value || null)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
        </div>

        <form.Field name="notes">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="notes">Anmerkungen</Label>
              <Textarea
                id="notes"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                rows={3}
              />
            </div>
          )}
        </form.Field>
      </div>

      <Separator />

      <AddressFormFields form={form} />

      <Separator />

      <ContactFormFields form={form} />

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit">Person speichern</Button>
      </div>
    </form>
  )
}
