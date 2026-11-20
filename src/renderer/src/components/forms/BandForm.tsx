import { useState } from 'react'
import { FormFooter } from './FormActions'
import { FormBody } from './FormFields'
import { required, useAppForm } from './appForm'
import { GenreField } from './GenreField'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { CompanyQuickCreateDialog } from '@/components/quick-create/CompanyQuickCreateDialog'
import { trpcReact } from '@/lib/trpc'
import type {
  BandDto,
  CreateBandInput,
  UpdateBandInput
} from '../../../../main/api/schemas/band.schema'
import type { FormMode } from '@/hooks/useFormSheet'
import { t } from '../../../../main/i18n/translate'

interface BandFormProps {
  mode: FormMode
  initialData?: BandDto | null
  onSubmit: (data: CreateBandInput | UpdateBandInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function BandForm({
  mode,
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false
}: BandFormProps) {
  // Fetch companies + persons for dropdowns
  const companies = trpcReact.company.getListItems.useQuery()
  const companyOptions = (companies.data ?? []).map((company) => ({
    value: company.id,
    label: company.name
  }))
  const persons = trpcReact.person.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()
  // "Neue Firma anlegen" from one of the two company pickers: which one gets the new company
  const [newCompany, setNewCompany] = useState<{
    field: 'companyId' | 'managementCompanyId'
    name: string
  } | null>(null)

  const form = useAppForm({
    defaultValues: {
      name: initialData?.name || '',
      genre: initialData?.genre || '',
      founded: initialData?.founded || '',
      notes: initialData?.notes || '',
      companyId: initialData?.companyId || 0,
      responsiblePersonId: initialData?.responsiblePersonId || null,
      managementCompanyId: initialData?.managementCompanyId ?? null
    },
    onSubmit: async ({ value }) => {
      if (mode === 'edit' && initialData) {
        onSubmit({
          id: initialData.id,
          name: value.name,
          genre: value.genre,
          founded: value.founded || null,
          notes: value.notes,
          companyId: value.companyId,
          responsiblePersonId: value.responsiblePersonId,
          managementCompanyId: value.managementCompanyId
        })
      } else {
        onSubmit({
          name: value.name,
          genre: value.genre,
          founded: value.founded || null,
          notes: value.notes,
          companyId: value.companyId,
          responsiblePersonId: value.responsiblePersonId,
          managementCompanyId: value.managementCompanyId
        })
      }
    }
  })

  return (
    <>
      <FormBody form={form} disabled={isSubmitting}>
        <form.AppField name="name" validators={{ onChange: required(t('Name')) }}>
          {(field) => (
            <field.TextField label={t('Name')} required placeholder={t('Bandnamen eingeben')} />
          )}
        </form.AppField>

        <form.AppField
          name="companyId"
          validators={{
            onChange: ({ value }) => {
              if (!value || value === 0) {
                return t('Firma ist erforderlich')
              }
              return undefined
            }
          }}
        >
          {(field) => (
            <field.FieldRow label={t('Firma')} required>
              {companies.isLoading ? (
                <div className="text-sm text-muted-foreground">{t('Firmen werden geladen…')}</div>
              ) : (
                <SearchableSelect
                  id={field.name}
                  value={field.state.value || null}
                  onChange={(value) => field.handleChange(value ?? 0)}
                  options={companyOptions}
                  placeholder={
                    companyOptions.length > 0 ? t('Firma auswählen') : t('Noch keine Firmen')
                  }
                  searchPlaceholder={t('Firma suchen…')}
                  emptyText={t('Keine Firma gefunden.')}
                  onCreateNew={(name) => setNewCompany({ field: 'companyId', name })}
                  createNewLabel={t('Neue Firma anlegen')}
                  disabled={isSubmitting}
                />
              )}
            </field.FieldRow>
          )}
        </form.AppField>

        <form.AppField name="responsiblePersonId">
          {(field) => (
            <field.FieldRow
              label={t('Technischer Leiter (TL)')}
              hint={t(
                'Ansprechpartner für Technikfragen, erscheint im Vertrag als Ansprechpartner VP1.'
              )}
            >
              {persons.isLoading ? (
                <div className="text-sm text-muted-foreground">{t('Personen werden geladen…')}</div>
              ) : persons.data && persons.data.length > 0 ? (
                <SearchableSelect
                  id={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={(persons.data ?? []).map((person) => ({
                    value: person.id,
                    label: `${person.firstName} ${person.lastName}`.trim()
                  }))}
                  noneLabel={t('Kein TL hinterlegt')}
                  searchPlaceholder={t('Person suchen…')}
                  disabled={isSubmitting}
                />
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t('Keine Personen vorhanden.')}
                </div>
              )}
            </field.FieldRow>
          )}
        </form.AppField>

        {/* Management company: "vertreten durch" in contracts */}
        <form.AppField name="managementCompanyId">
          {(field) => (
            <field.FieldRow
              label={t('Management (vertreten durch)')}
              hint={t(
                'Vertritt die Band in Auftrittsverträgen (Briefkopf, „vertreten durch“, Unterschrift VP1). Einzelne Events können das überschreiben.'
              )}
            >
              <SearchableSelect
                id={field.name}
                value={field.state.value}
                onChange={field.handleChange}
                options={companyOptions}
                noneLabel={t('Standard ({{value}})', {
                  value: defaultCompany.data?.name ?? t('keine Standard-Firma')
                })}
                searchPlaceholder={t('Firma suchen…')}
                emptyText={t('Keine Firma gefunden.')}
                onCreateNew={(name) => setNewCompany({ field: 'managementCompanyId', name })}
                createNewLabel={t('Neue Firma anlegen')}
                disabled={isSubmitting || companies.isLoading}
              />
            </field.FieldRow>
          )}
        </form.AppField>

        <form.AppField name="genre">
          {(field) => (
            <field.FieldRow label={t('Genre')}>
              <GenreField
                id={field.name}
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                placeholder={t('z. B. Rock, Metal, Pop')}
                disabled={isSubmitting}
              />
            </field.FieldRow>
          )}
        </form.AppField>

        <form.AppField name="founded">
          {(field) => <field.TextField label={t('Gründung')} placeholder="z. B. 1965" />}
        </form.AppField>

        <form.AppField name="notes">
          {(field) => (
            <field.TextareaField
              label={t('Anmerkungen')}
              placeholder={t('Weitere Anmerkungen hinzufügen…')}
              rows={4}
            />
          )}
        </form.AppField>

        <FormFooter onCancel={onCancel} submitting={isSubmitting}>
          {mode === 'create' ? t('Anlegen') : t('Speichern')}
        </FormFooter>
      </FormBody>

      {/* Outside the form: its submit would bubble into this one through the portal */}
      <CompanyQuickCreateDialog
        isOpen={newCompany !== null}
        prefillName={newCompany?.name ?? ''}
        onClose={() => setNewCompany(null)}
        onCreated={(id) => {
          if (newCompany) form.setFieldValue(newCompany.field, id)
        }}
      />
    </>
  )
}
