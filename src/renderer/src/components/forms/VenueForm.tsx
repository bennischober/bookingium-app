import { SearchableSelect } from '@/components/ui/searchable-select'
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
import { contactHasValues } from './contactEmailFields'
import { trpcReact } from '@/lib/trpc'
import type { FormMode } from '@/hooks/useFormSheet'
import {
  VENUE_KIND_LABELS,
  VenueKind,
  type CreateVenueInput,
  type UpdateVenueInput,
  type VenueDto
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
      kind: initialData?.kind ?? ('venue' as VenueKind),
      capacity: initialData?.capacity?.toString() ?? '',
      genres: initialData?.genres ?? '',
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
        otherEmails: initialData?.contact?.otherEmails ?? [],
        phone: initialData?.contact?.phone ?? '',
        mobilePhone: initialData?.contact?.mobilePhone ?? '',
        homepage: initialData?.contact?.homepage ?? '',
        noAdvertising: initialData?.contact?.noAdvertising ?? false
      }
    },
    onSubmit: async ({ value }) => {
      const parsedCapacity = value.capacity.trim() ? Number(value.capacity) : null
      const capacity = Number.isNaN(parsedCapacity) ? null : parsedCapacity
      const hasAddress = Object.values(value.address).some((entry) => entry.trim().length > 0)
      const hasContact = contactHasValues(value.contact)
      const basePayload = {
        name: value.name.trim(),
        kind: value.kind,
        capacity,
        genres: value.genres,
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

      <form.Field name="kind">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Art</Label>
            <Select
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as VenueKind)}
              disabled={isSubmitting}
            >
              <SelectTrigger id={field.name}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VenueKind.options.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {VENUE_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <form.Field name="genres">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Genres</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="z. B. Metal, Rock"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Mit Komma trennen; wird für die Verteiler genutzt.
            </p>
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
              <p className="text-sm text-muted-foreground">Firmen werden geladen…</p>
            ) : companies.data && companies.data.length > 0 ? (
              <SearchableSelect
                id={field.name}
                value={field.state.value}
                onChange={field.handleChange}
                options={companies.data.map((company) => ({
                  value: company.id,
                  label: company.name
                }))}
                noneLabel="Keine"
                searchPlaceholder="Firma suchen…"
                disabled={isSubmitting}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Keine Firmen gefunden.</p>
            )}
          </div>
        )}
      </form.Field>

      <Separator />
      <AddressFormFields form={form} />

      <Separator />
      <ContactFormFields form={form} showNoAdvertising />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Speichert…'
            : mode === 'create'
              ? 'Spielstätte anlegen'
              : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  )
}
