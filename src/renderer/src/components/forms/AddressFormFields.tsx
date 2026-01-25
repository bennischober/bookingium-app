import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

interface AddressFormFieldsProps {
  form: any // TanStack Form instance
}

export function AddressFormFields({ form }: AddressFormFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Address</h3>

      <div className="grid grid-cols-2 gap-4">
        <form.Field name="address.street">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="address.street">Street</Label>
              <Input
                id="address.street"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="address.streetNumber">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="address.streetNumber">Street Number</Label>
              <Input
                id="address.streetNumber"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="address.addressSuffix">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="address.addressSuffix">Address Suffix</Label>
            <Input
              id="address.addressSuffix"
              value={field.state.value || ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Apt, Suite, Floor, etc."
            />
          </div>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-4">
        <form.Field name="address.zipCode">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="address.zipCode">ZIP Code</Label>
              <Input
                id="address.zipCode"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="address.city">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="address.city">City</Label>
              <Input
                id="address.city"
                value={field.state.value || ''}
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

      <form.Field name="address.state">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="address.state">State/Province</Label>
            <Input
              id="address.state"
              value={field.state.value || ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-4">
        <form.Field name="address.country">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="address.country">Country</Label>
              <Input
                id="address.country"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="address.countryCode">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="address.countryCode">Country Code</Label>
              <Input
                id="address.countryCode"
                value={field.state.value || ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                maxLength={2}
                placeholder="US, DE, etc."
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
              )}
            </div>
          )}
        </form.Field>
      </div>
    </div>
  )
}
