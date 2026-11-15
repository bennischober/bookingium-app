import { createFormHook } from '@tanstack/react-form'
import { fieldContext, formContext } from './formContext'
import { FieldRow, SelectField, SwitchField, TextField, TextareaField } from './FormFields'

/**
 * #171: the app's TanStack form. Use it instead of `useForm`: `form.AppField` hands the
 * field components (`TextField`, `TextareaField`, `SelectField`, `SwitchField`, `FieldRow`)
 * to its render function, so a field is one line. Wrap the fields in `FormBody` and end
 * with `FormFooter`.
 */
export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextareaField, SelectField, SwitchField, FieldRow },
  formComponents: {}
})

/** The validator of a required text field: "<label> ist erforderlich" while it is blank */
export function required(label: string) {
  return ({ value }: { value: string | null | undefined }): string | undefined =>
    !value || value.trim().length === 0 ? `${label} ist erforderlich` : undefined
}
