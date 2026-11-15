import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Star, X } from 'lucide-react'
import { otherEmailProblem, promoteOtherEmail } from './contactEmailFields'
import { useFormDisabled } from './formContext'

// The parent form instance (`useAppForm`). Typed loosely on purpose: these shared fields
// are embedded in several forms with different value shapes, and TanStack Form's FormApi
// generic needs a dozen type parameters that would couple this component to one parent's
// exact shape. The parent's defaultValues take `contactDefaults()` (or
// `basicContactDefaults()` without the further addresses and the switch; `formDefaults.ts`).
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
  const disabled = useFormDisabled()
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Kontaktinformationen</h3>
      <form.AppField name="contact.email">
        {(field) => <field.TextField label="E-Mail" type="email" placeholder="email@example.com" />}
      </form.AppField>

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
                            disabled={disabled}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Als Haupt-Adresse"
                            title="Als Haupt-Adresse"
                            disabled={disabled || !(field.state.value || '').trim()}
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
                            disabled={disabled}
                          >
                            <X />
                          </Button>
                        </div>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
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
                  disabled={disabled}
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
        <form.AppField name="contact.phone">
          {(field) => <field.TextField label="Telefon" type="tel" placeholder="+1 234 567 8900" />}
        </form.AppField>
        <form.AppField name="contact.mobilePhone">
          {(field) => <field.TextField label="Mobil" type="tel" placeholder="+1 234 567 8900" />}
        </form.AppField>
      </div>

      <form.AppField name="contact.homepage">
        {(field) => (
          <field.TextField label="Homepage" type="url" placeholder="https://example.com" />
        )}
      </form.AppField>

      {showNoAdvertising && (
        <form.AppField name="contact.noAdvertising">
          {(field) => (
            <field.SwitchField
              label="Keine Werbung"
              hint="Diese Adresse kommt in keinen Verteiler (z. B. nach einem Werbewiderspruch)."
            />
          )}
        </form.AppField>
      )}
    </div>
  )
}
