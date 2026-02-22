interface ReadOnlyFieldProps {
  label: string
  value?: string | null
  placeholder?: string
}

export function ReadOnlyField({ label, value, placeholder = '—' }: ReadOnlyFieldProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {value ? (
        <p className="text-sm leading-relaxed">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">{placeholder}</p>
      )}
    </div>
  )
}
