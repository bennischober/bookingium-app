import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BandDto, CreateBandInput, UpdateBandInput } from '../../../../main/api/schemas/band.schema'
import type { FormMode } from '@/hooks/useFormSheet'

interface BandFormProps {
  mode: FormMode
  initialData?: BandDto | null
  onSubmit: (data: CreateBandInput | UpdateBandInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function BandForm({ mode, initialData, onSubmit, onCancel, isSubmitting = false }: BandFormProps) {
  const form = useForm({
    defaultValues: {
      name: initialData?.name || '',
      genre: initialData?.genre || '',
      founded: initialData?.founded || '',
      notes: initialData?.notes || ''
    },
    onSubmit: async ({ value }) => {
      if (mode === 'edit' && initialData) {
        onSubmit({
          id: initialData.id,
          name: value.name,
          genre: value.genre,
          founded: value.founded || null,
          notes: value.notes,
          companyId: initialData.companyId
        })
      } else {
        onSubmit({
          name: value.name,
          genre: value.genre,
          founded: value.founded || null,
          notes: value.notes,
          companyId: 1 // TODO: Get from context or user selection
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
              placeholder="Enter band name"
              disabled={isSubmitting}
            />
            {field.state.meta.errors && field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
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
              placeholder="e.g., Rock, Metal, Pop"
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      {/* Founded Field */}
      <form.Field name="founded">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Founded</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="e.g., 1965"
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      {/* Notes Field */}
      <form.Field name="notes">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Notes</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Add any additional notes..."
              rows={4}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Band' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
