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

export interface SearchableSelectOption<T extends string | number = number> {
  value: T
  label: string
  /** Shown muted after the label and searched too (e.g. a city) */
  hint?: string
}

interface SearchableSelectProps<T extends string | number> {
  /** For <Label htmlFor> */
  id?: string
  value: T | null | undefined
  onChange: (value: T | null) => void
  options: SearchableSelectOption<T>[]
  /** Text while nothing is chosen */
  placeholder?: string
  /** Adds a first entry that clears the choice (e.g. "Keine") */
  noneLabel?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Dropdown for long lists (companies, persons, …): type to filter, the list
 * scrolls. Looks like the regular Select.
 */
export function SearchableSelect<T extends string | number = number>({
  id,
  value,
  onChange,
  options,
  placeholder = 'Auswählen…',
  noneLabel,
  searchPlaceholder = 'Suchen…',
  emptyText = 'Keine Treffer.',
  disabled = false,
  className,
  'aria-label': ariaLabel
}: SearchableSelectProps<T>) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)
  const triggerText = selected?.label ?? (value == null && noneLabel ? noneLabel : placeholder)

  const choose = (next: T | null) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            !selected && !(value == null && noneLabel) && 'text-muted-foreground',
            className
          )}
        >
          <span className="min-w-0 truncate">{triggerText}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
        align="start"
        // Inside a sheet/dialog its scroll lock would swallow the wheel
        // (the list renders in a portal outside the dialog)
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <Command>
          {/* Focused on open (first focusable element): type to filter */}
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {noneLabel && (
                <CommandItem value={`__none ${noneLabel}`} onSelect={() => choose(null)}>
                  <Check className={cn('h-4 w-4', value == null ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-muted-foreground">{noneLabel}</span>
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={String(option.value)}
                  // Unique per option; label and hint are what the search matches
                  value={`${option.label} ${option.hint ?? ''} #${option.value}`}
                  onSelect={() => choose(option.value)}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      option.value === value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
