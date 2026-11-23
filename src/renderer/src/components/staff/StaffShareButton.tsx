import { useState } from 'react'
import { Eye, EyeOff, Users } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { useStaffAccess } from '@/hooks/useStaffAccess'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { StaffGrantChoice, StaffGrantEntity } from '../../../../main/api/schemas/staff.schema'
import { t } from '../../../../main/i18n/translate'

/** What a record does without a grant, in the words of the popover */
const DEFAULT_LABELS: Record<StaffGrantEntity, string> = {
  band: t('Standard: nur die Band als Kontakt'),
  deal_memo: t('Standard: wie die Band'),
  document: t('Standard: wie das Event'),
  management_contract: t('Standard: intern'),
  invoice: t('Standard: intern'),
  event_settlement: t('Standard: intern'),
  receipt: t('Standard: intern'),
  trip: t('Standard: intern')
}

const SHARED_LABELS: Partial<Record<StaffGrantEntity, string>> = {
  band: t('Freigegeben, mit Events und Booking')
}

/**
 * #262 "Mitarbeiter": who of the employees sees this record, and the grant per employee (or for
 * all). Shown only on an admin computer that has employees.
 */
export function StaffShareButton({
  entity,
  entityId,
  size = 'sm'
}: {
  entity: StaffGrantEntity
  entityId: number
  size?: 'sm' | 'icon'
}) {
  const { locked } = useStaffAccess()
  const hasEmployees = trpcReact.staff.hasEmployees.useQuery(undefined, {
    enabled: !locked,
    staleTime: 60_000
  })
  const enabled = !locked && hasEmployees.data === true
  const target = { entity, entityId }
  const utils = trpcReact.useUtils()
  const [open, setOpen] = useState(false)
  // in a table (icon) the state is only asked for when the popover opens
  const state = trpcReact.staff.grantState.useQuery(target, {
    enabled: enabled && (size === 'sm' || open)
  })
  const setGrant = trpcReact.staff.setGrant.useMutation({
    onSuccess: (next) => utils.staff.grantState.setData(target, next),
    onError: (error) =>
      toast.error(t('Freigabe konnte nicht gespeichert werden'), { description: error.message })
  })
  if (!enabled) return null

  const employees = state.data?.employees ?? []
  const seeing = employees.filter((e) => e.visible).length
  const choices = (forAll: boolean): Array<{ value: StaffGrantChoice; label: string }> => [
    {
      value: 'default',
      label: forAll ? DEFAULT_LABELS[entity] : t('Wie für alle')
    },
    { value: 'shared', label: SHARED_LABELS[entity] ?? t('Freigegeben') },
    { value: 'internal', label: t('Intern') }
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size={size === 'icon' ? 'icon' : 'sm'}
          variant="outline"
          className={size === 'icon' ? 'h-7 w-7' : 'gap-1.5'}
          aria-label={t('Für Mitarbeiter freigeben')}
          title={t('{{seeing}} von {{total}} Mitarbeitern sehen das', {
            seeing,
            total: employees.length
          })}
        >
          <Users className="h-3.5 w-3.5" />
          {size === 'sm' && (
            <span>
              {t('Mitarbeiter')}
              {state.data ? ` ${seeing}/${employees.length}` : ''}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium">{t('Für Mitarbeiter freigeben')}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              'Mitarbeiter bekommen nur, was hier freigegeben ist. Änderungen gehen mit dem nächsten Abgleich hinaus.'
            )}
          </p>
        </div>
        <GrantRow
          label={t('Alle Mitarbeiter')}
          value={state.data?.all ?? 'default'}
          options={choices(true)}
          disabled={!state.data || setGrant.isPending}
          onChange={(choice) => setGrant.mutate({ ...target, employeeId: null, choice })}
        />
        {employees.map((employee) => (
          <GrantRow
            key={employee.id}
            label={employee.name}
            visible={employee.visible}
            value={employee.choice}
            options={choices(false)}
            disabled={setGrant.isPending}
            onChange={(choice) => setGrant.mutate({ ...target, employeeId: employee.id, choice })}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

function GrantRow({
  label,
  visible,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  visible?: boolean
  value: StaffGrantChoice
  options: Array<{ value: StaffGrantChoice; label: string }>
  disabled: boolean
  onChange: (choice: StaffGrantChoice) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{label}</span>
        {visible !== undefined && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title={visible ? t('Sieht es') : t('Sieht es nicht')}
          >
            {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {visible ? t('sieht es') : t('sieht es nicht')}
          </span>
        )}
      </div>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as StaffGrantChoice)}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 w-full text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
