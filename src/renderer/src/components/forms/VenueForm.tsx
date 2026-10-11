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
import { trpcReact } from '@/lib/trpc'
import type { FormMode } from '@/hooks/useFormSheet'
import type {
  CreateVenueInput,
  UpdateVenueInput,
  VenueDto
} from '../../../../main/api/schemas/venue.schema'

interface VenueFormProps {
  mode: FormMode
  initialData?: VenueDto | null
  onSubmit: (data: CreateVenueInput | UpdateVenueInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function VenueForm({
  mode,
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false
}: VenueFormProps) {
  const companies = trpcReact.company.getListItems.useQuery()

  const form = useForm({
    defaultValues: {
      name: initialData?.name ?? '',
      capacity: initialData?.capacity?.toString() ?? '',
      notes: initialData?.notes ?? '',
      companyId: initialData?.company?.id ?? null,
      address: {
        street: initialData?.address?.street ?? '',
        streetNumber: initialData?.address?.streetNumber ?? '',
        addressSuffix: initialData?.address?.addressSuffix ?? '',
        zipCode: initialData?.address?.zipCode ?? '',
        city: initialData?.address?.city ?? '',
        state: initialData?.address?.state ?? '',
        country: initialData?.address?.country ?? '',
        countryCode: initialData?.address?.countryCode ?? ''
      },
      contact: {
        email: initialData?.contact?.email ?? '',
        phone: initialData?.contact?.phone ?? '',
        mobilePhone: initialData?.contact?.mobilePhone ?? '',
        homepage: initialData?.contact?.homepage ?? ''
      }
    },
    onSubmit: async ({ value }) => {
      const parsedCapacity = value.capacity.trim() ? Number(value.capacity) : null
      const capacity = Number.isNaN(parsedCapacity) ? null : parsedCapacity
      const hasAddress = Object.values(value.address).some((entry) => entry.trim().length > 0)
      const hasContact = Object.values(value.contact).some((entry) => entry.trim().length > 0)
      const basePayload = {
        name: value.name.trim(),
        capacity,
        notes: value.notes.trim(),
        companyId: value.companyId,
        ...(hasAddress ? { address: value.address } : {}),
        ...(hasContact ? { contact: value.contact } : {})
      }

      if (mode === 'edit' && initialData) {
        onSubmit({ id: initialData.id, ...basePayload })
        return
      }

      onSubmit(basePayload)
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
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => {
            if (!value || value.trim().length === 0) {
              return 'Name ist erforderlich'
            }
            return undefined
          }
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Spielstättennamen eingeben"
              disabled={isSubmitting}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field
        name="capacity"
        validators={{
          onChange: ({ value }) => {
            if (!value.trim()) return undefined
            const parsed = Number(value)
            if (Number.isNaN(parsed) || parsed < 0) {
              return 'Kapazität muss eine positive Zahl sein'
            }
            return undefined
          }
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Kapazität</Label>
            <Input
              id={field.name}
              type="number"
              min={0}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="z. B. 1200"
              disabled={isSubmitting}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="notes">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Anmerkungen</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Weitere Details zu dieser Spielstätte"
              rows={4}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="companyId">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Verknüpfte Firma (optional)</Label>
            {companies.isLoading ? (
              <p className="text-sm text-muted-foreground">Firmen werden geladen...</p>
            ) : companies.data && companies.data.length > 0 ? (
              <Select
                value={field.state.value ? String(field.state.value) : 'none'}
                onValueChange={(value) =>
                  field.handleChange(value === 'none' ? null : Number(value))
                }
                disabled={isSubmitting}
              >
                <SelectTrigger id={field.name}>
                  <SelectValue placeholder="Firma auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine</SelectItem>
                  {companies.data.map((company) => (
                    <SelectItem key={company.id} value={String(company.id)}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">Keine Firmen gefunden.</p>
            )}
          </div>
        )}
      </form.Field>

      <Separator />
      <AddressFormFields form={form} />

      <Separator />
      <ContactFormFields form={form} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Speichert...'
            : mode === 'create'
              ? 'Spielstätte anlegen'
              : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  )
}
