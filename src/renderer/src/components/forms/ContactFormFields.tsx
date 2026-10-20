import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

// The parent form instance (TanStack Form). Typed loosely on purpose: these
// shared fields are embedded in several forms with different value shapes,
// and TanStack Form's FormApi generic needs 11 type parameters that would
// couple this component to one parent's exact shape. The Field calls below
// are string-path fields with string values (contact.noAdvertising is a boolean).
interface ContactFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  // Shows the Keine-Werbung switch (persons, companies and venues; the parent's
  // defaultValues must then contain contact.noAdvertising)
  showNoAdvertising?: boolean
}

export function ContactFormFields({ form, showNoAdvertising = false }: ContactFormFieldsProps) {
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

      {showNoAdvertising && (
        <form.Field name="contact.noAdvertising">
          {(field) => (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Switch
                  id="contact.noAdvertising"
                  checked={field.state.value === true}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                <Label htmlFor="contact.noAdvertising">Keine Werbung</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Diese Adresse kommt in keinen Verteiler (z. B. nach einem Werbewiderspruch).
              </p>
            </div>
          )}
        </form.Field>
      )}
    </div>
  )
}
