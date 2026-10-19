import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  canNavigate,
  entryLabel,
  useNavigationHistory,
  type HistoryEntry
} from '@/lib/navigationHistory'

// Mouse side buttons ("back"/"forward" thumb buttons)
const MOUSE_BACK = 3
const MOUSE_FORWARD = 4

/** Visited pages as a right-click menu on the back/forward button */
function HistoryButton({
  direction,
  entries,
  current,
  disabled,
  onClick,
  onJump
}: {
  direction: 'back' | 'forward'
  entries: HistoryEntry[]
  current: number
  disabled: boolean
  onClick: () => void
  onJump: (delta: number) => void
}) {
  const isBack = direction === 'back'
  const Icon = isBack ? ArrowLeft : ArrowRight
  const label = isBack ? 'Zurück' : 'Vorwärts'
  const keys = isBack ? 'Alt+←' : 'Alt+→'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled || entries.length === 0}>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          title={`${label} (${keys}) – Rechtsklick zeigt den Verlauf`}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-80" aria-label={`Verlauf ${label.toLowerCase()}`}>
        <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
          {isBack ? 'Zuletzt geöffnet' : 'Weiter zu'}
        </ContextMenuLabel>
        {entries.slice(0, 15).map((entry) => (
          <ContextMenuItem key={entry.index} onSelect={() => onJump(entry.index - current)}>
            <span className="truncate">{entryLabel(entry)}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Back/forward through the pages opened in the app, across records (event →
 * invoice → band …), complementing the breadcrumbs' "where am I". Also on
 * Alt+←/→ and the mouse's side buttons.
 */
export function HistoryNav() {
  const router = useRouter()
  const { canGoBack, canGoForward, backEntries, forwardEntries, index } = useNavigationHistory()

  useEffect(() => {
    const back = (): void => {
      if (canNavigate('back')) router.history.back()
    }
    const forward = (): void => {
      if (canNavigate('forward')) router.history.forward()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        forward()
      }
    }
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === MOUSE_BACK) {
        event.preventDefault()
        back()
      } else if (event.button === MOUSE_FORWARD) {
        event.preventDefault()
        forward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [router])

  return (
    <nav aria-label="Verlauf" className="-ml-1 flex shrink-0 items-center">
      <HistoryButton
        direction="back"
        entries={backEntries}
        current={index}
        disabled={!canGoBack}
        onClick={() => router.history.back()}
        onJump={(delta) => router.history.go(delta)}
      />
      <HistoryButton
        direction="forward"
        entries={forwardEntries}
        current={index}
        disabled={!canGoForward}
        onClick={() => router.history.forward()}
        onJump={(delta) => router.history.go(delta)}
      />
    </nav>
  )
}
