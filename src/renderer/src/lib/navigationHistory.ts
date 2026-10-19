import { useSyncExternalStore } from 'react'
import type { RouterHistory } from '@tanstack/react-router'
import { ROUTES, isRouteActive } from '@/lib/routing'

// ========================================
// In-app back/forward history
// ========================================
// Mirrors the router's history stack (by its __TSR_index) so the top bar can
// tell whether forward is possible and list the visited pages by name. The
// breadcrumbs report each page's readable label ("Events › LA Showcase").

export type HistoryEntry = {
  /** Position in the router history */
  index: number
  href: string
  pathname: string
  label: string | null
}

type State = {
  entries: Array<HistoryEntry | undefined>
  index: number
}

let state: State = { entries: [], index: 0 }
const listeners = new Set<() => void>()

function setState(next: State): void {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Starts mirroring the router history; returns the unsubscribe function */
export function trackNavigationHistory(history: RouterHistory): () => void {
  const record = (location: RouterHistory['location'], push: boolean): void => {
    const index = location.state.__TSR_index ?? 0
    // A new page drops everything that was ahead of it (like a browser)
    const entries = push ? state.entries.slice(0, index) : [...state.entries]
    const known = entries[index]
    entries[index] = {
      index,
      href: location.href,
      pathname: location.pathname,
      // Same page (tab switch via replace, back/forward): keep its label
      label: known?.pathname === location.pathname ? known.label : null
    }
    setState({ entries, index })
  }

  record(history.location, true)
  return history.subscribe(({ location, action }) => record(location, action.type === 'PUSH'))
}

/** The readable label of the current page, once its names are loaded */
export function setCurrentPageLabel(pathname: string, label: string): void {
  const current = state.entries[state.index]
  if (!current || current.pathname !== pathname || current.label === label) return
  const entries = [...state.entries]
  entries[state.index] = { ...current, label }
  setState({ entries, index: state.index })
}

const PRINT_LABELS: Array<[RegExp, string]> = [
  [/^\/invoices\/\d+\/print/, 'Rechnung (Druckansicht)'],
  [/^\/events\/\d+\/contract\/print/, 'Vertrag (Druckansicht)'],
  [/^\/management-contracts\/\d+\/print/, 'Managementvertrag (Druckansicht)']
]

/** Whether back/forward has somewhere to go (no leaving the app at either end) */
export function canNavigate(direction: 'back' | 'forward'): boolean {
  return direction === 'back' ? state.index > 0 : state.entries.length - 1 > state.index
}

/** Label for the history menu; pages without breadcrumbs get a generic one */
export function entryLabel(entry: HistoryEntry): string {
  if (entry.label) return entry.label
  const print = PRINT_LABELS.find(([pattern]) => pattern.test(entry.pathname))
  if (print) return print[1]
  const section = Object.values(ROUTES).find((route) => isRouteActive(route.path, entry.pathname))
  return section?.title ?? entry.pathname
}

export function useNavigationHistory(): {
  canGoBack: boolean
  canGoForward: boolean
  /** Earlier pages, most recent first */
  backEntries: HistoryEntry[]
  /** Later pages, nearest first */
  forwardEntries: HistoryEntry[]
  index: number
} {
  const current = useSyncExternalStore(subscribe, () => state)
  const known = (entry: HistoryEntry | undefined): entry is HistoryEntry => entry !== undefined
  return {
    // After a reload the earlier entries are unknown but still reachable
    canGoBack: current.index > 0,
    canGoForward: current.entries.length - 1 > current.index,
    backEntries: current.entries.slice(0, current.index).filter(known).reverse(),
    forwardEntries: current.entries.slice(current.index + 1).filter(known),
    index: current.index
  }
}
