import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

interface ContactFormFieldsProps {
  form: any // TanStack Form instance
}

export function ContactFormFields({ form }: ContactFormFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Kontaktinformationen</h3>
      <form.Field name="contact.email">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="contact.email">E-Mail</Label>
            <Input
              id="contact.email"
              type="email"
              value={field.state.value || ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="email@example.com"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-4">
        <form.Field name="contact.phone">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="contact.phone">Telefon</Label>
              <Input
                id="contact.phone"
                type="tel"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="+1 234 567 8900"
              />
            </div>
          )}
        </form.Field>

        <form.Field name="contact.mobilePhone">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="contact.mobilePhone">Mobil</Label>
              <Input
                id="contact.mobilePhone"
                type="tel"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="+1 234 567 8900"
              />
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="contact.homepage">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="contact.homepage">Homepage</Label>
            <Input
              id="contact.homepage"
              type="url"
              value={field.state.value || ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="https://example.com"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>
    </div>
  )
}
