/**
 * Whether a main-frame navigation stays on the app's own page.
 *
 * Routes are hash routes, so moving inside the app never navigates. Anything else would replace
 * the app with another page: a file dropped on the window, or a stray link. A reload of the same
 * page is allowed.
 */
export function isAppDocument(target: string, current: string): boolean {
  try {
    const next = new URL(target)
    const here = new URL(current)
    return (
      next.origin === here.origin && next.pathname === here.pathname && next.search === here.search
    )
  } catch {
    return false
  }
}
