import { useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FormDisabledContext, useFieldContext, useFormDisabled } from './formContext'
import { useReportUnsavedChanges } from '@/components/formGuard'

/**
 * #171: the one way a form field looks. `FieldShell` is the plain layout (label with the
 * required marker, the control, a hint, the first error) and needs no form library, so
 * `useState` forms can use it too. The other components are the `useAppForm` field
 * components (`<form.AppField name="x">{(field) => <field.TextField label="X" />}`): they
 * read value, change, blur and errors from the field and the disabled state from `FormBody`.
 */

interface FieldShellProps {
  /** The control's id, which the label points to */
  id?: string
  label?: ReactNode
  /** Shows the `*` after the label. Validation is the field's `validators`. */
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}

export function FieldShell({
  id,
  label,
  required = false,
  hint,
  error,
  className,
  children
}: FieldShellProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {label !== undefined && (
        <Label htmlFor={id}>
          {label}
          {required && (
            <>
              {' '}
              <span className="text-destructive">*</span>
            </>
          )}
        </Label>
      )}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** The part of a TanStack form's store that says whether a value differs from its default */
interface FormValueStore {
  state: { isDefaultValue: boolean }
  subscribe: (listener: () => void) => () => void
}

/**
 * The form element: submits through TanStack Form, disables every field while saving and
 * tells a surrounding `FormSheet` when a value was changed, so closing it asks first
 */
export function FormBody({
  form,
  disabled = false,
  className,
  children
}: {
  form: { handleSubmit: () => unknown; store?: FormValueStore }
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const store = form.store
  const changed = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => (store ? !store.state.isDefaultValue : false)
  )
  useReportUnsavedChanges(changed)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
      className={cn('space-y-6', className)}
    >
      <FormDisabledContext.Provider value={disabled}>{children}</FormDisabledContext.Provider>
    </form>
  )
}

/** The first error of a field, as text */
function fieldError(field: { state: { meta: { errors: unknown[] } } }): string | undefined {
  const error = field.state.meta.errors[0]
  return error === undefined || error === null ? undefined : String(error)
}

interface FieldLabelProps {
  label: ReactNode
  required?: boolean
  hint?: ReactNode
}

/** Label, hint and error around a custom control (a SearchableSelect, the GenreField) */
export function FieldRow({
  label,
  required,
  hint,
  children
}: FieldLabelProps & { children: ReactNode }) {
  const field = useFieldContext<unknown>()
  return (
    <FieldShell
      id={field.name}
      label={label}
      required={required}
      hint={hint}
      error={fieldError(field)}
    >
      {children}
    </FieldShell>
  )
}

type InputProps = Omit<
  ComponentProps<'input'>,
  'id' | 'name' | 'value' | 'onChange' | 'onBlur' | 'required'
>

export function TextField({
  label,
  required,
  hint,
  nullIfEmpty = false,
  disabled,
  ...input
}: FieldLabelProps &
  InputProps & {
    /** Stores an emptied field as null (an optional date) */
    nullIfEmpty?: boolean
  }) {
  const field = useFieldContext<string | null>()
  const formDisabled = useFormDisabled()
  return (
    <FieldShell
      id={field.name}
      label={label}
      required={required}
      hint={hint}
      error={fieldError(field)}
    >
      <Input
        id={field.name}
        value={field.state.value ?? ''}
        onChange={(e) => field.handleChange(nullIfEmpty && !e.target.value ? null : e.target.value)}
        onBlur={field.handleBlur}
        disabled={disabled ?? formDisabled}
        {...input}
      />
    </FieldShell>
  )
}

type TextareaProps = Omit<
  ComponentProps<'textarea'>,
  'id' | 'name' | 'value' | 'onChange' | 'onBlur' | 'required'
>

export function TextareaField({
  label,
  required,
  hint,
  disabled,
  ...textarea
}: FieldLabelProps & TextareaProps) {
  const field = useFieldContext<string>()
  const formDisabled = useFormDisabled()
  return (
    <FieldShell
      id={field.name}
      label={label}
      required={required}
      hint={hint}
      error={fieldError(field)}
    >
      <Textarea
        id={field.name}
        value={field.state.value ?? ''}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        disabled={disabled ?? formDisabled}
        {...textarea}
      />
    </FieldShell>
  )
}

/** A fixed choice; the options carry the stored value and its German label */
export function SelectField({
  label,
  required,
  hint,
  options
}: FieldLabelProps & { options: readonly { value: string; label: string }[] }) {
  const field = useFieldContext<string>()
  const disabled = useFormDisabled()
  return (
    <FieldShell
      id={field.name}
      label={label}
      required={required}
      hint={hint}
      error={fieldError(field)}
    >
      <Select
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
        disabled={disabled}
      >
        <SelectTrigger id={field.name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

/** A switch with its label beside it and the hint below */
export function SwitchField({ label, hint }: { label: ReactNode; hint?: ReactNode }) {
  const field = useFieldContext<boolean>()
  const disabled = useFormDisabled()
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <Switch
          id={field.name}
          checked={field.state.value === true}
          onCheckedChange={(checked) => field.handleChange(checked)}
          disabled={disabled}
        />
        <Label htmlFor={field.name}>{label}</Label>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
