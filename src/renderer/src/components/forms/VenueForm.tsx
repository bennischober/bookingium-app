import { useState } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { CompanyQuickCreateDialog } from '@/components/quick-create/CompanyQuickCreateDialog'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { FormFooter } from './FormActions'
import { FormBody } from './FormFields'
import { required, useAppForm } from './appForm'
import { GenreField } from './GenreField'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { addressDefaults, contactDefaults, optionalAddress, optionalContact } from './formDefaults'
import { trpcReact } from '@/lib/trpc'
import type { FormMode } from '@/hooks/useFormSheet'
import { useMapPreview } from '@/hooks/useMapPreview'
import { RadiusFields } from '@/components/map/RadiusFields'
import {
  defaultClause,
  draftFromOverride,
  parseOverrideDraft
} from '@/components/map/radiusDisplay'
import {
  VENUE_KIND_LABELS,
  VenueKind,
  type CreateVenueInput,
  type UpdateVenueInput,
  type VenueDto
} from '../../../../main/api/schemas/venue.schema'

const KIND_OPTIONS = VenueKind.options.map((kind) => ({
  value: kind,
  label: VENUE_KIND_LABELS[kind]
}))

interface VenueFormProps {
  mode: FormMode
  initialData?: VenueDto | null
  /** Kind of a new venue: the list it is created from */
  defaultKind?: VenueKind
  onSubmit: (data: CreateVenueInput | UpdateVenueInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function VenueForm({
  mode,
  initialData,
  defaultKind = 'venue',
  onSubmit,
  onCancel,
  isSubmitting = false
}: VenueFormProps) {
  const companies = trpcReact.company.getListItems.useQuery()
  // Radius clause fields only with the map on; off, an edit keeps the stored values
  const mapPreview = useMapPreview()
  // "Neue Firma anlegen" from the company picker, with what was typed
  const [newCompanyName, setNewCompanyName] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: {
      name: initialData?.name ?? '',
      kind: initialData?.kind ?? defaultKind,
      capacity: initialData?.capacity?.toString() ?? '',
      genres: initialData?.genres ?? '',
      notes: initialData?.notes ?? '',
      companyId: initialData?.company?.id ?? null,
      radius: draftFromOverride(initialData),
      address: addressDefaults(initialData?.address),
      contact: contactDefaults(initialData?.contact)
    },
    onSubmit: async ({ value }) => {
      const parsedCapacity = value.capacity.trim() ? Number(value.capacity) : null
      const capacity = Number.isNaN(parsedCapacity) ? null : parsedCapacity
      const radius = parseOverrideDraft(value.radius)
      if (mapPreview.enabled && !radius.ok) return
      const basePayload = {
        name: value.name.trim(),
        kind: value.kind,
        capacity,
        genres: value.genres,
        notes: value.notes.trim(),
        companyId: value.companyId,
        ...optionalAddress(value.address),
        ...optionalContact(value.contact),
        ...(mapPreview.enabled && radius.ok ? radius.value : {})
      }

      if (mode === 'edit' && initialData) {
        onSubmit({ id: initialData.id, ...basePayload })
        return
      }

      onSubmit(basePayload)
    }
  })

  return (
    <>
      <FormBody form={form} disabled={isSubmitting}>
        <form.AppField name="name" validators={{ onChange: required('Name') }}>
          {(field) => <field.TextField label="Name" required placeholder="Namen eingeben" />}
        </form.AppField>

        <form.AppField name="kind">
          {(field) => <field.SelectField label="Art" options={KIND_OPTIONS} />}
        </form.AppField>

        <form.AppField
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
            <field.TextField label="Kapazität" type="number" min={0} placeholder="z. B. 1200" />
          )}
        </form.AppField>

        <form.AppField name="genres">
          {(field) => (
            <field.FieldRow
              label="Genres"
              hint="Mit Komma trennen, bekannte Genres werden vorgeschlagen; wird für die Verteiler genutzt."
            >
              <GenreField
                id={field.name}
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                disabled={isSubmitting}
              />
            </field.FieldRow>
          )}
        </form.AppField>

        <form.AppField name="notes">
          {(field) => (
            <field.TextareaField label="Anmerkungen" placeholder="Weitere Details" rows={4} />
          )}
        </form.AppField>

        <form.AppField name="companyId">
          {(field) => (
            <field.FieldRow label="Verknüpfte Firma (optional)">
              {companies.isLoading ? (
                <p className="text-sm text-muted-foreground">Firmen werden geladen…</p>
              ) : (
                <SearchableSelect
                  id={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={(companies.data ?? []).map((company) => ({
                    value: company.id,
                    label: company.name
                  }))}
                  noneLabel="Keine"
                  searchPlaceholder="Firma suchen…"
                  emptyText="Keine Firma gefunden."
                  onCreateNew={setNewCompanyName}
                  createNewLabel="Neue Firma anlegen"
                  disabled={isSubmitting}
                />
              )}
            </field.FieldRow>
          )}
        </form.AppField>

        {mapPreview.enabled && mapPreview.defaults && (
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) => (
              <form.Field
                name="radius"
                validators={{
                  onChange: ({ value }) => {
                    const parsed = parseOverrideDraft(value)
                    return parsed.ok ? undefined : parsed.error
                  }
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label>Gebietsschutz</Label>
                    <RadiusFields
                      id="venue-radius"
                      value={field.state.value}
                      onChange={field.handleChange}
                      inherited={defaultClause(mapPreview.defaults!, kind)}
                      inheritedFrom={`den Standard für ${kind === 'festival' ? 'Festivals' : 'Clubs'}`}
                      error={field.state.meta.errors[0]?.toString()}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </form.Field>
            )}
          </form.Subscribe>
        )}

        <Separator />
        <AddressFormFields form={form} />

        <Separator />
        <ContactFormFields form={form} showNoAdvertising />

        <FormFooter onCancel={onCancel} submitting={isSubmitting}>
          {mode === 'create' ? 'Anlegen' : 'Speichern'}
        </FormFooter>
      </FormBody>

      {/* Outside the form: its submit would bubble into this one through the portal */}
      <CompanyQuickCreateDialog
        isOpen={newCompanyName !== null}
        prefillName={newCompanyName ?? ''}
        onClose={() => setNewCompanyName(null)}
        onCreated={(id) => form.setFieldValue('companyId', id)}
      />
    </>
  )
}
