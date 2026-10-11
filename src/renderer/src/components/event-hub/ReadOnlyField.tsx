interface ReadOnlyFieldProps {
  label: string
  value?: string | null
  placeholder?: string
  className?: string
}

export function ReadOnlyField({ label, value, placeholder = '—', className }: ReadOnlyFieldProps) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {value ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">{placeholder}</p>
      )}
    </div>
  )
}
