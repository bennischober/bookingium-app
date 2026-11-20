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
import {
  capacityError,
  capacityInputText,
  parseCapacityRange
} from '../../../../main/api/schemas/capacity'
import { t } from '../../../../main/i18n/translate'

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
      capacity: capacityInputText(initialData?.capacityMin, initialData?.capacity),
      genres: initialData?.genres ?? '',
      notes: initialData?.notes ?? '',
      companyId: initialData?.company?.id ?? null,
      radius: draftFromOverride(initialData),
      address: addressDefaults(initialData?.address),
      contact: contactDefaults(initialData?.contact)
    },
    onSubmit: async ({ value }) => {
      const range = parseCapacityRange(value.capacity)
      const radius = parseOverrideDraft(value.radius)
      if (mapPreview.enabled && !radius.ok) return
      const basePayload = {
        name: value.name.trim(),
        kind: value.kind,
        capacity: range.max,
        capacityMin: range.min,
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
        <form.AppField name="name" validators={{ onChange: required(t('Name')) }}>
          {(field) => (
            <field.TextField label={t('Name')} required placeholder={t('Namen eingeben')} />
          )}
        </form.AppField>

        <form.AppField name="kind">
          {(field) => <field.SelectField label={t('Art')} options={KIND_OPTIONS} />}
        </form.AppField>

        <form.AppField
          name="capacity"
          validators={{
            onChange: ({ value }) => capacityError(value)
          }}
        >
          {(field) => (
            <field.TextField
              label={t('Kapazität')}
              inputMode="numeric"
              placeholder={t('z. B. 1200 oder 500-1000')}
              hint={t('Eine Zahl oder eine Spanne von–bis, je nach Bestuhlung oder Raum.')}
            />
          )}
        </form.AppField>

        <form.AppField name="genres">
          {(field) => (
            <field.FieldRow
              label={t('Genres')}
              hint={t(
                'Mit Komma trennen, bekannte Genres werden vorgeschlagen; wird für die Verteiler genutzt.'
              )}
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
            <field.TextareaField
              label={t('Anmerkungen')}
              placeholder={t('Weitere Details')}
              rows={4}
            />
          )}
        </form.AppField>

        <form.AppField name="companyId">
          {(field) => (
            <field.FieldRow label={t('Verknüpfte Firma (optional)')}>
              {companies.isLoading ? (
                <p className="text-sm text-muted-foreground">{t('Firmen werden geladen…')}</p>
              ) : (
                <SearchableSelect
                  id={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={(companies.data ?? []).map((company) => ({
                    value: company.id,
                    label: company.name
                  }))}
                  noneLabel={t('Keine')}
                  searchPlaceholder={t('Firma suchen…')}
                  emptyText={t('Keine Firma gefunden.')}
                  onCreateNew={setNewCompanyName}
                  createNewLabel={t('Neue Firma anlegen')}
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
                    <Label>{t('Gebietsschutz')}</Label>
                    <RadiusFields
                      id="venue-radius"
                      value={field.state.value}
                      onChange={field.handleChange}
                      inherited={defaultClause(mapPreview.defaults!, kind)}
                      inheritedFrom={t('den Standard für {{value}}', {
                        value: kind === 'festival' ? t('Festivals') : t('Clubs')
                      })}
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
          {mode === 'create' ? t('Anlegen') : t('Speichern')}
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
