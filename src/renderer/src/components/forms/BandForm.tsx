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
              <div className="text-sm text-muted-foreground">Firmen werden geladen...</div>
            ) : companies.data && companies.data.length > 0 ? (
              <Select
                value={field.state.value.toString()}
                onValueChange={(value) => field.handleChange(parseInt(value))}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Firma auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {companies.data.map((company) => (
                    <SelectItem key={company.id} value={company.id.toString()}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <div className="text-sm text-muted-foreground">Personen werden geladen...</div>
            ) : persons.data && persons.data.length > 0 ? (
              <Select
                value={field.state.value ? field.state.value.toString() : 'none'}
                onValueChange={(value) =>
                  field.handleChange(value === 'none' ? null : parseInt(value))
                }
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="TL auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein TL hinterlegt</SelectItem>
                  {persons.data.map((person) => (
                    <SelectItem key={person.id} value={person.id.toString()}>
                      {person.firstName} {person.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Select
              value={field.state.value ? field.state.value.toString() : 'none'}
              onValueChange={(value) =>
                field.handleChange(value === 'none' ? null : parseInt(value))
              }
              disabled={isSubmitting || companies.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Management auswählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  Standard ({defaultCompany.data?.name ?? 'keine Standard-Firma'})
                </SelectItem>
                {(companies.data ?? []).map((company) => (
                  <SelectItem key={company.id} value={company.id.toString()}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              placeholder="Weitere Anmerkungen hinzufügen..."
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
            ? 'Speichert...'
            : mode === 'create'
              ? 'Band anlegen'
              : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  )
}
