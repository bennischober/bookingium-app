import { t } from '../../../../main/i18n/translate'
// The parent form instance (`useAppForm`). Typed loosely on purpose: these shared fields
// are embedded in several forms with different value shapes, and TanStack Form's FormApi
// generic needs a dozen type parameters that would couple this component to one parent's
// exact shape. The parent's defaultValues take `addressDefaults()` (`formDefaults.ts`).
interface AddressFormFieldsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
}

export function AddressFormFields({ form }: AddressFormFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('Adresse')}</h3>

      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="address.street">
          {(field) => <field.TextField label={t('Straße')} />}
        </form.AppField>
        <form.AppField name="address.streetNumber">
          {(field) => <field.TextField label={t('Hausnummer')} />}
        </form.AppField>
      </div>

      <form.AppField name="address.addressSuffix">
        {(field) => (
          <field.TextField label={t('Adresszusatz')} placeholder={t('Wohnung, Etage, etc.')} />
        )}
      </form.AppField>

      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="address.zipCode">
          {(field) => <field.TextField label="PLZ" />}
        </form.AppField>
        <form.AppField name="address.city">
          {(field) => <field.TextField label={t('Stadt')} />}
        </form.AppField>
      </div>

      <form.AppField name="address.state">
        {(field) => <field.TextField label={t('Bundesland')} />}
      </form.AppField>

      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="address.country">
          {(field) => <field.TextField label={t('Land')} />}
        </form.AppField>
        <form.AppField name="address.countryCode">
          {(field) => (
            <field.TextField
              label={t('Ländercode')}
              maxLength={2}
              placeholder={t('US, DE, etc.')}
            />
          )}
        </form.AppField>
      </div>
    </div>
  )
}
