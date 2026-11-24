import { useMemo } from 'react'
import { Separator } from '@/components/ui/separator'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { trpcReact } from '@/lib/trpc'
import { FormFooter } from './FormActions'
import { FormBody } from './FormFields'
import { required, useAppForm } from './appForm'
import type { FormMode } from '@/hooks/useFormSheet'
import {
  RELEASE_TYPE_LABELS,
  ReleaseType,
  type CreateReleaseInput,
  type ReleaseDto,
  type UpdateReleaseInput
} from '../../../../main/api/schemas/release.schema'
import { t } from '../../../../main/i18n/translate'

interface ReleaseFormProps {
  mode: FormMode
  initialData?: ReleaseDto | null
  /** A new release from a band page starts with that band */
  defaultBandId?: number | null
  onSubmit: (data: CreateReleaseInput | UpdateReleaseInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

const TYPE_OPTIONS = ReleaseType.options.map((value) => ({
  value,
  label: RELEASE_TYPE_LABELS[value]
}))

/** The head data of a release (#289); tracks, products and credits are edited on its page */
export function ReleaseForm({
  mode,
  initialData,
  defaultBandId = null,
  onSubmit,
  onCancel,
  isSubmitting = false
}: ReleaseFormProps) {
  const bands = trpcReact.band.getListItems.useQuery()
  const bandOptions = useMemo(
    () => (bands.data ?? []).map((band) => ({ value: band.id, label: band.name })),
    [bands.data]
  )

  const form = useAppForm({
    defaultValues: {
      bandId: initialData?.bandId ?? defaultBandId,
      artistName: initialData?.artistName ?? '',
      title: initialData?.title ?? '',
      version: initialData?.version ?? '',
      releaseType: (initialData?.releaseType ?? 'album') as string,
      releaseDate: initialData?.releaseDate ?? null,
      originalReleaseDate: initialData?.originalReleaseDate ?? null,
      preorderD2cDate: initialData?.preorderD2cDate ?? null,
      preorderRetailDate: initialData?.preorderRetailDate ?? null,
      preorderDigitalDate: initialData?.preorderDigitalDate ?? null,
      label: initialData?.label ?? '',
      catalogNumber: initialData?.catalogNumber ?? '',
      pLine: initialData?.pLine ?? '',
      cLine: initialData?.cLine ?? '',
      genre: initialData?.genre ?? '',
      subGenre: initialData?.subGenre ?? '',
      metadataLanguage: initialData?.metadataLanguage ?? '',
      recordingCountry: initialData?.recordingCountry ?? '',
      projectNumber: initialData?.projectNumber ?? '',
      notes: initialData?.notes ?? ''
    },
    onSubmit: async ({ value }) => {
      const payload: CreateReleaseInput = {
        ...value,
        releaseType: ReleaseType.catch('album').parse(value.releaseType),
        title: value.title.trim()
      }
      if (mode === 'edit' && initialData) onSubmit({ id: initialData.id, ...payload })
      else onSubmit(payload)
    }
  })

  return (
    <FormBody form={form} disabled={isSubmitting}>
      <form.AppField name="bandId">
        {(field) => (
          <field.FieldRow
            label={t('Band')}
            hint={t('Leer lassen für ein Release ohne eigene Band.')}
          >
            <SearchableSelect
              id={field.name}
              value={field.state.value}
              onChange={(value) => field.handleChange(value)}
              options={bandOptions}
              noneLabel={t('Keine eigene Band')}
              placeholder={t('Band auswählen')}
              searchPlaceholder={t('Band suchen…')}
              emptyText={t('Keine Band gefunden.')}
              disabled={isSubmitting}
            />
          </field.FieldRow>
        )}
      </form.AppField>

      <form.AppField name="artistName">
        {(field) => (
          <field.TextField
            label={t('Artist')}
            hint={t('Wie auf dem Release angegeben; leer bedeutet der Name der Band.')}
          />
        )}
      </form.AppField>

      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="title" validators={{ onChange: required(t('Titel')) }}>
          {(field) => <field.TextField label={t('Titel')} required />}
        </form.AppField>
        <form.AppField name="version">
          {(field) => (
            <field.TextField label={t('Version')} placeholder={t('z. B. Deluxe Edition')} />
          )}
        </form.AppField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="releaseType">
          {(field) => <field.SelectField label={t('Art')} options={TYPE_OPTIONS} />}
        </form.AppField>
        <form.AppField name="releaseDate">
          {(field) => <field.TextField label={t('VÖ-Datum')} type="date" nullIfEmpty />}
        </form.AppField>
      </div>

      <Separator />
      <h3 className="text-lg font-semibold">{t('Label und Rechte')}</h3>
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="label">
          {(field) => <field.TextField label={t('Label')} />}
        </form.AppField>
        <form.AppField name="catalogNumber">
          {(field) => <field.TextField label={t('Katalognummer')} />}
        </form.AppField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="pLine">
          {(field) => <field.TextField label={t('℗-Zeile')} placeholder="℗ 2027 …" />}
        </form.AppField>
        <form.AppField name="cLine">
          {(field) => <field.TextField label={t('©-Zeile')} placeholder="© 2027 …" />}
        </form.AppField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="genre">
          {(field) => <field.TextField label={t('Genre')} />}
        </form.AppField>
        <form.AppField name="subGenre">
          {(field) => <field.TextField label={t('Subgenre')} />}
        </form.AppField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="metadataLanguage">
          {(field) => <field.TextField label={t('Sprache der Metadaten')} />}
        </form.AppField>
        <form.AppField name="recordingCountry">
          {(field) => <field.TextField label={t('Aufnahmeland')} />}
        </form.AppField>
      </div>
      <form.AppField name="projectNumber">
        {(field) => <field.TextField label={t('Projektnummer')} />}
      </form.AppField>

      <Separator />
      <h3 className="text-lg font-semibold">{t('Weitere Termine')}</h3>
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="originalReleaseDate">
          {(field) => (
            <field.TextField
              label={t('Erst-VÖ (Re-Issue)')}
              type="date"
              nullIfEmpty
              hint={t('Nur bei einer Wiederveröffentlichung.')}
            />
          )}
        </form.AppField>
        <form.AppField name="preorderD2cDate">
          {(field) => <field.TextField label={t('Pre-Order D2C')} type="date" nullIfEmpty />}
        </form.AppField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="preorderRetailDate">
          {(field) => <field.TextField label={t('Pre-Order Handel')} type="date" nullIfEmpty />}
        </form.AppField>
        <form.AppField name="preorderDigitalDate">
          {(field) => <field.TextField label={t('Pre-Order digital')} type="date" nullIfEmpty />}
        </form.AppField>
      </div>

      <Separator />
      <form.AppField name="notes">
        {(field) => <field.TextareaField label={t('Anmerkungen')} rows={4} />}
      </form.AppField>

      <FormFooter onCancel={onCancel} submitting={isSubmitting}>
        {mode === 'create' ? t('Anlegen') : t('Speichern')}
      </FormFooter>
    </FormBody>
  )
}
