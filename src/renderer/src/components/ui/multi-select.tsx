import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

export interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  options: MultiSelectOption[]
  /** Text while nothing is chosen (e.g. "Alle Länder") */
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  'aria-label'?: string
}

/**
 * Dropdown that keeps several values (filters): click toggles, the list
 * stays open, type to filter. Looks like the regular Select.
 */
export function MultiSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Suchen…',
  emptyText = 'Keine Treffer.',
  className,
  'aria-label': ariaLabel
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const chosen = options.filter((option) => value.includes(option.value))
  // Chosen values the options no longer have (a saved list) still show
  const unknown = value.filter((entry) => !options.some((option) => option.value === entry))
  const labels = [...chosen.map((option) => option.label), ...unknown]

  const toggle = (entry: string) =>
    onChange(value.includes(entry) ? value.filter((v) => v !== entry) : [...value, entry])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring',
            labels.length === 0 && 'text-muted-foreground',
            className
          )}
        >
          <span className="min-w-0 truncate">
            {labels.length === 0 ? placeholder : labels.join(', ')}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
        align="start"
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {[...options, ...unknown.map((entry) => ({ value: entry, label: entry }))].map(
                (option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} #${option.value}`}
                    onSelect={() => toggle(option.value)}
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        value.includes(option.value) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </CommandItem>
                )
              )}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 && (
          <button
            type="button"
            className="w-full border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            onClick={() => onChange([])}
          >
            Auswahl aufheben
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
