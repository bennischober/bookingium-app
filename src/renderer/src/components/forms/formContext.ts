import { createContext, useContext } from 'react'
import { createFormHookContexts } from '@tanstack/react-form'

/**
 * #171: the contexts behind `useAppForm` (`appForm.ts`). The field components in
 * `FormFields.tsx` read their field through `useFieldContext`.
 */
export const { fieldContext, formContext, useFieldContext } = createFormHookContexts()

/**
 * Whether the form around a field is disabled (while it saves). `FormBody` provides it,
 * so a form says `disabled` once instead of on every field.
 */
export const FormDisabledContext = createContext(false)

export function useFormDisabled(): boolean {
  return useContext(FormDisabledContext)
}
