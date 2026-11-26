import { cn } from '@/lib/utils'
import type { Address } from './composeDraft'
import { t } from '../../../../main/i18n/translate'

/**
 * #306: the suggestions for an "@" in the compose editor, at the caret. Picking happens on
 * mouse down, before the editor's blur would close the menu.
 */
export function MentionMenu({
  items,
  active,
  position,
  recipients,
  onPick,
  onHover
}: {
  items: Address[]
  active: number
  /** The caret's position in the viewport */
  position: { left: number; top: number }
  /** Who is on the mail already: they get no "wird hinzugefügt" note */
  recipients: Set<string>
  onPick: (address: Address) => void
  onHover: (index: number) => void
}) {
  if (items.length === 0) return null
  return (
    <ul
      className="fixed z-50 max-w-sm min-w-56 overflow-hidden rounded-md border bg-popover text-sm shadow-md"
      style={{ left: position.left, top: position.top }}
      role="listbox"
      aria-label={t('Person erwähnen')}
    >
      {items.map((address, i) => (
        <li
          key={address.email}
          role="option"
          aria-selected={i === active}
          className={cn('cursor-pointer px-3 py-1.5', i === active && 'bg-muted')}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(address)
          }}
          onMouseEnter={() => onHover(i)}
        >
          <div className="truncate">{address.name || address.email}</div>
          <div className="truncate text-xs text-muted-foreground">
            {address.name ? address.email : null}
            {!recipients.has(address.email.toLowerCase()) && (
              <span className="ml-1 text-muted-foreground/70">
                {t('wird als Empfänger hinzugefügt')}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
