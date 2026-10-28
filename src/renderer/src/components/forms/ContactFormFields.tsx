import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Plus, Star, X } from 'lucide-react'
import { otherEmailProblem, promoteOtherEmail } from './contactEmailFields'

// The parent form instance (TanStack Form). Typed loosely on purpose: these
// shared fields are embedded in several forms with different value shapes,
// and TanStack Form's FormApi generic needs 11 type parameters that would
// couple this component to one parent's exact shape. The Field calls below
// are string-path fields with string values (contact.noAdvertising is a boolean,
// contact.otherEmails a string array; the parent's defaultValues must contain it).
interface ContactFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  // Shows the Keine-Werbung switch (persons, companies and venues; the parent's
  // defaultValues must then contain contact.noAdvertising)
  showNoAdvertising?: boolean
  // Shows the further addresses (the parent's defaultValues must then contain
  // contact.otherEmails). Off for hotels: they only fill the itinerary and get no
  // mail, and the further addresses are only used for mail linking.
  showOtherEmails?: boolean
}

export function ContactFormFields({
  form,
  showNoAdvertising = false,
  showOtherEmails = true
}: ContactFormFieldsProps) {
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

      {showOtherEmails && (
        <form.Field name="contact.otherEmails" mode="array">
          {(listField) => {
            const others: string[] = listField.state.value ?? []
            // Sits right under the primary address (cancels the parent's space-y-4); the
            // label and the hint show only once there is a further address
            return (
              <div className="-mt-2 space-y-2">
                {others.length > 0 && <Label className="block pt-2">Weitere E-Mail-Adressen</Label>}
                {others.map((_, index) => (
                  <form.Field
                    key={index}
                    name={`contact.otherEmails[${index}]`}
                    validators={{
                      onChangeListenTo: ['contact.email', 'contact.otherEmails'],
                      onChange: ({ value }) =>
                        otherEmailProblem(
                          value ?? '',
                          index,
                          form.getFieldValue('contact.email') ?? '',
                          form.getFieldValue('contact.otherEmails') ?? []
                        )
                    }}
                  >
                    {(field) => (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Input
                            id={`contact.otherEmails.${index}`}
                            type="email"
                            aria-label={`Weitere E-Mail-Adresse ${index + 1}`}
                            value={field.state.value || ''}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="email@example.com"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Als Haupt-Adresse"
                            title="Als Haupt-Adresse"
                            disabled={!(field.state.value || '').trim()}
                            onClick={() => {
                              const next = promoteOtherEmail(
                                form.getFieldValue('contact.email') ?? '',
                                form.getFieldValue('contact.otherEmails') ?? [],
                                index
                              )
                              form.setFieldValue('contact.email', next.email)
                              form.setFieldValue('contact.otherEmails', next.otherEmails)
                            }}
                          >
                            <Star />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Adresse entfernen"
                            title="Adresse entfernen"
                            onClick={() => listField.removeValue(index)}
                          >
                            <X />
                          </Button>
                        </div>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
                        )}
                      </div>
                    )}
                  </form.Field>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-7 px-2 text-muted-foreground hover:text-foreground"
                  title="Mails von und an weitere Adressen werden dem Kontakt ebenfalls zugeordnet"
                  onClick={() => listField.pushValue('')}
                >
                  <Plus />
                  Weitere Adresse
                </Button>
                {others.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Mails von und an diese Adressen werden dem Kontakt ebenfalls zugeordnet.
                    Rechnungen und Verteiler nutzen die Haupt-Adresse.
                  </p>
                )}
              </div>
            )
          }}
        </form.Field>
      )}

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
