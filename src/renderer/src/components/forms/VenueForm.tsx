import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { FormMode } from '@/hooks/useFormSheet'
import type { CreateVenueInput, UpdateVenueInput, VenueDto } from '../../../../main/api/schemas/venue.schema'

interface VenueFormProps {
  mode: FormMode
  initialData?: VenueDto | null
  onSubmit: (data: CreateVenueInput | UpdateVenueInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function VenueForm({ mode, initialData, onSubmit, onCancel, isSubmitting = false }: VenueFormProps) {
  const form = useForm({
    defaultValues: {
      name: initialData?.name ?? '',
      capacity: initialData?.capacity?.toString() ?? '',
      notes: initialData?.notes ?? ''
    },
    onSubmit: async ({ value }) => {
      const parsedCapacity = value.capacity.trim() ? Number(value.capacity) : null
      const capacity = Number.isNaN(parsedCapacity) ? null : parsedCapacity

      if (mode === 'edit' && initialData) {
        onSubmit({
          id: initialData.id,
          name: value.name.trim(),
          capacity,
          notes: value.notes.trim()
        })
        return
      }

      onSubmit({
        name: value.name.trim(),
        capacity,
        notes: value.notes.trim()
      })
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
              return 'Name is required'
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
              placeholder="Enter venue name"
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
              return 'Capacity must be a positive number'
            }
            return undefined
          }
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Capacity</Label>
            <Input
              id={field.name}
              type="number"
              min={0}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="e.g. 1200"
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
            <Label htmlFor={field.name}>Notes</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Add additional details about this venue"
              rows={4}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Venue' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
