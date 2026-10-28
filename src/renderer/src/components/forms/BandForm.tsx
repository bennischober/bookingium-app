import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { trpcReact } from '@/lib/trpc'
import type {
  BandDto,
  CreateBandInput,
  UpdateBandInput
} from '../../../../main/api/schemas/band.schema'
import type { FormMode } from '@/hooks/useFormSheet'

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

  const form = useForm({
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
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-6"
    >
      {/* Name Field */}
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
              placeholder="Bandnamen eingeben"
              disabled={isSubmitting}
            />
            {field.state.meta.errors && field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      {/* Company Field */}
      <form.Field
        name="companyId"
        validators={{
          onChange: ({ value }) => {
            if (!value || value === 0) {
              return 'Firma ist erforderlich'
            }
            return undefined
          }
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>
              Firma <span className="text-destructive">*</span>
            </Label>
            {companies.isLoading ? (
              <div className="text-sm text-muted-foreground">Firmen werden geladen…</div>
            ) : companies.data && companies.data.length > 0 ? (
              <SearchableSelect
                id={field.name}
                value={field.state.value || null}
                onChange={(value) => field.handleChange(value ?? 0)}
                options={companyOptions}
                placeholder="Firma auswählen"
                searchPlaceholder="Firma suchen…"
                disabled={isSubmitting}
              />
            ) : (
              <div className="text-sm text-destructive">
                Keine Firmen vorhanden. Bitte legen Sie zuerst eine Firma an.
              </div>
            )}
            {field.state.meta.errors && field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      {/* Technischer Leiter (TL) Field */}
      <form.Field name="responsiblePersonId">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Technischer Leiter (TL)</Label>
            {persons.isLoading ? (
              <div className="text-sm text-muted-foreground">Personen werden geladen…</div>
            ) : persons.data && persons.data.length > 0 ? (
              <SearchableSelect
                id={field.name}
                value={field.state.value}
                onChange={field.handleChange}
                options={(persons.data ?? []).map((person) => ({
                  value: person.id,
                  label: `${person.firstName} ${person.lastName}`.trim()
                }))}
                noneLabel="Kein TL hinterlegt"
                searchPlaceholder="Person suchen…"
                disabled={isSubmitting}
              />
            ) : (
              <div className="text-sm text-muted-foreground">Keine Personen vorhanden.</div>
            )}
            <p className="text-xs text-muted-foreground">
              Ansprechpartner für Technikfragen, erscheint im Vertrag als Ansprechpartner VP1.
            </p>
          </div>
        )}
      </form.Field>

      {/* Management company: "vertreten durch" in contracts */}
      <form.Field name="managementCompanyId">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Management (vertreten durch)</Label>
            <SearchableSelect
              id={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              options={companyOptions}
              noneLabel={`Standard (${defaultCompany.data?.name ?? 'keine Standard-Firma'})`}
              searchPlaceholder="Firma suchen…"
              disabled={isSubmitting || companies.isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Vertritt die Band in Konzertverträgen (Briefkopf, „vertreten durch“, Unterschrift
              VP1). Einzelne Events können das überschreiben.
            </p>
          </div>
        )}
      </form.Field>

      {/* Genre Field */}
      <form.Field name="genre">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Genre</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="z. B. Rock, Metal, Pop"
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      {/* Founded Field */}
      <form.Field name="founded">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Gründung</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="z. B. 1965"
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      {/* Notes Field */}
      <form.Field name="notes">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Anmerkungen</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Weitere Anmerkungen hinzufügen…"
              rows={4}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Speichert…'
            : mode === 'create'
              ? 'Band anlegen'
              : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  )
}
