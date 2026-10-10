import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { trpcReact } from '@/main'
import { CompanyDto } from 'src/main/api/schemas/company.schema'

interface CompanyFormProps {
  company?: CompanyDto
  onSubmit: (data: any) => void
  onCancel: () => void
}

export function CompanyForm({ company, onSubmit, onCancel }: CompanyFormProps) {
  // Fetch banks for dropdown
  const banks = trpcReact.bank.getListItems.useQuery()

  const form = useForm({
    defaultValues: {
      name: company?.name || '',
      notes: company?.notes || '',
      vatNumber: company?.vatNumber || '',
      ustNumber: company?.ustNumber || '',
      taxNumber: company?.taxNumber || '',
      commercialRegisterNo: company?.commercialRegisterNo || '',
      registerCourt: company?.registerCourt || '',
      website: company?.website || '',
      bankId: company?.bank?.id || null,
      address: {
        street: company?.address?.street || '',
        streetNumber: company?.address?.streetNumber || '',
        addressSuffix: company?.address?.addressSuffix || '',
        zipCode: company?.address?.zipCode || '',
        city: company?.address?.city || '',
        state: company?.address?.state || '',
        country: company?.address?.country || '',
        countryCode: company?.address?.countryCode || ''
      },
      contact: {
        email: company?.contact?.email || '',
        phone: company?.contact?.phone || '',
        mobilePhone: company?.contact?.mobilePhone || '',
        homepage: company?.contact?.homepage || ''
      }
    },
    onSubmit: async ({ value }) => {
      onSubmit(company ? { ...value, id: company.id } : value)
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
        <h3 className="text-lg font-semibold">Company Information</h3>

        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
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

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="vatNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="vatNumber">VAT Number</Label>
                <Input
                  id="vatNumber"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="ustNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="ustNumber">USt Number</Label>
                <Input
                  id="ustNumber"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="taxNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="taxNumber">Tax Number (Steuernummer)</Label>
                <Input
                  id="taxNumber"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="commercialRegisterNo">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="commercialRegisterNo">Commercial Register No. (HR-Nr.)</Label>
                <Input
                  id="commercialRegisterNo"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="registerCourt">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="registerCourt">Register Court (Amtsgericht)</Label>
                <Input
                  id="registerCourt"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
        </div>

        <form.Field name="website">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>

        <form.Field name="bankId">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="bankId">Bank (Optional)</Label>
              {banks.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading banks...</p>
              ) : banks.data && banks.data.length > 0 ? (
                <Select
                  value={field.state.value?.toString() || ''}
                  onValueChange={(value) => field.handleChange(value ? Number(value) : null)}
                >
                  <SelectTrigger id="bankId">
                    <SelectValue placeholder="Select a bank" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {banks.data.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id.toString()}>
                        {bank.bankName} - {bank.accountHolder}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No banks available. Create a bank first in the Banks page.
                </p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
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
          Cancel
        </Button>
        <Button type="submit">Save Company</Button>
      </div>
    </form>
  )
}
