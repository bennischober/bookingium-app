/**
 * Sends the renderer's unexpected errors to the local error log (src/main/utils/errorLog.ts):
 * errors nothing caught, and render errors a boundary caught. Only an error's text and stack
 * leave the page, never what the page shows; main scrubs addresses and caps the length.
 */

// Chromium's notice that a ResizeObserver callback ran late: harmless and frequent
const IGNORED = [/ResizeObserver loop/]

export function reportError(error: unknown, componentStack?: string): void {
  try {
    const e = error instanceof Error ? error : null
    const message = e ? `${e.name}: ${e.message}` : String(error)
    if (IGNORED.some((pattern) => pattern.test(message))) return
    const stack =
      [e?.stack, componentStack ? `Component stack:${componentStack}` : undefined]
        .filter(Boolean)
        .join('\n') || undefined
    window.api.reportError({ message, stack })
  } catch {
    // reporting must never raise an error of its own
  }
}

let installed = false

/** Errors that reach the window: thrown in a handler or a timer, or a promise nobody awaited */
export function installErrorReporting(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', (event) => reportError(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
}
