import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RadiusClause } from '../../../../main/api/schemas/radius.schema'
import { RADIUS_KM_MAX, RADIUS_WEEKS_MAX } from '../../../../main/map/radius'
import { formatClause, type RadiusDraft } from './radiusDisplay'

interface RadiusFieldsProps {
  /** Prefix for the input ids */
  id: string
  value: RadiusDraft
  onChange: (value: RadiusDraft) => void
  /** What an empty field falls back to; omitted, every field is required (the defaults) */
  inherited?: RadiusClause
  /** Where the fallback comes from, e.g. "Standard für Clubs" */
  inheritedFrom?: string
  error?: string
  disabled?: boolean
}

const FIELDS = [
  { key: 'km', label: 'Radius (km)', min: 1, max: RADIUS_KM_MAX },
  { key: 'weeksBefore', label: 'Wochen vorher', min: 0, max: RADIUS_WEEKS_MAX },
  { key: 'weeksAfter', label: 'Wochen nachher', min: 0, max: RADIUS_WEEKS_MAX }
] as const

/** The three inputs of a radius clause (Gebietsschutz), side by side */
export function RadiusFields({
  id,
  value,
  onChange,
  inherited,
  inheritedFrom,
  error,
  disabled
}: RadiusFieldsProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={`${id}-${field.key}`} className="text-xs">
              {field.label}
            </Label>
            <Input
              id={`${id}-${field.key}`}
              type="number"
              min={field.min}
              max={field.max}
              step={1}
              value={value[field.key]}
              onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
              placeholder={inherited ? inherited[field.key].toString() : undefined}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        inherited && (
          <p className="text-xs text-muted-foreground">
            Leere Felder übernehmen {inheritedFrom ?? 'den Standard'}: {formatClause(inherited)}.
          </p>
        )
      )}
    </div>
  )
}
