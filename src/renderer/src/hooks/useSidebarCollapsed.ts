import { useCallback, useEffect, useState } from 'react'

const MAIL_PATH = '/mail'

/** The mail page wants the width for its panes, so it starts collapsed and keeps its own setting */
const modeOf = (pathname: string) =>
  pathname === MAIL_PATH || pathname.startsWith(`${MAIL_PATH}/`) ? 'mail' : 'app'
const DEFAULT_COLLAPSED = { mail: true, app: false }
const storageKey = (mode: 'mail' | 'app') => `sidebar.collapsed.${mode}`

function readCollapsed(mode: 'mail' | 'app'): boolean {
  try {
    const stored = localStorage.getItem(storageKey(mode))
    return stored === null ? DEFAULT_COLLAPSED[mode] : stored === 'true'
  } catch {
    return DEFAULT_COLLAPSED[mode]
  }
}

/**
 * Whether the app sidebar shows only its icons, remembered across restarts, once for the mail
 * page and once for the rest. Ctrl+B toggles it, except while typing (bold in an editor).
 */
export function useSidebarCollapsed(pathname: string) {
  const mode = modeOf(pathname)
  const [collapsed, setCollapsed] = useState(() => ({
    mail: readCollapsed('mail'),
    app: readCollapsed('app')
  }))

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current[mode]
      try {
        localStorage.setItem(storageKey(mode), String(next))
      } catch {
        // Only a convenience; the setting just isn't kept
      }
      return { ...current, [mode]: next }
    })
  }, [mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
      if (event.key.toLowerCase() !== 'b') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable]')) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return [collapsed[mode], toggle] as const
}
