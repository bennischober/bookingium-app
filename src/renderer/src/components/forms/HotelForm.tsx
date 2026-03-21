import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { FormMode } from '@/hooks/useFormSheet'
import type { CreateHotelInput, HotelDto, UpdateHotelInput } from '../../../../main/api/schemas/hotel.schema'

interface HotelFormProps {
  mode: FormMode
  initialData?: HotelDto | null
  onSubmit: (data: CreateHotelInput | UpdateHotelInput) => void
  onCancel: () => void
  isSubmitting?: boolean
}

export function HotelForm({ mode, initialData, onSubmit, onCancel, isSubmitting = false }: HotelFormProps) {
  const form = useForm({
    defaultValues: {
      name: initialData?.name ?? '',
      notes: initialData?.notes ?? ''
    },
    onSubmit: async ({ value }) => {
      if (mode === 'edit' && initialData) {
        onSubmit({
          id: initialData.id,
          name: value.name.trim(),
          notes: value.notes.trim()
        })
        return
      }

      onSubmit({
        name: value.name.trim(),
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
              placeholder="Enter hotel name"
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
              placeholder="Add additional details about this hotel"
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
          {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Hotel' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
