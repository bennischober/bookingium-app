// The Rules of Hooks, checked where the lint rule cannot see it.
//
// G10 added a subscription to MessageView to report image progress. It was placed AFTER the
// component's two early returns, so it ran on some renders and not others - React threw
// "Rendered more hooks than during the previous render" and the view crashed when opening a real mail.
//
// eslint's react-hooks/rules-of-hooks does NOT catch this: it recognises identifiers starting with
// "use", and `trpcReact.mail.events.useSubscription(...)` is a property access on a proxy. Verified:
// a plain `useState` after the same early return IS reported, the tRPC call is not.
//
// So this pins the invariant directly for this component: every hook call must appear before the first
// early return.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/mail/MessageView.tsx'),
  'utf8'
)

/** The MessageView body, from its signature to the closing brace of the component */
function body(): string {
  const start = source.indexOf('export function MessageView(')
  expect(start).toBeGreaterThan(-1)
  return source.slice(start)
}

/** Index of the first early return in the component body, or -1 */
function firstEarlyReturn(text: string): number {
  const match =
    /\n {2}if \([^)]*\) \{\n {4}return/.exec(text) ?? /\n {2}if \([^)]*\) return/.exec(text)
  return match ? match.index : -1
}

describe('MessageView: hooks run before any early return', () => {
  it('has an early return, so the check below is meaningful', () => {
    // if the component ever stops returning early, this test would silently pass
    expect(firstEarlyReturn(body())).toBeGreaterThan(-1)
  })

  it('places the image-progress subscription before the first early return', () => {
    // the regression: this hook sat after both returns and crashed the view on a real mail
    const text = body()
    const hookAt = text.indexOf('trpcReact.mail.events.useSubscription')
    const returnAt = firstEarlyReturn(text)
    expect(hookAt).toBeGreaterThan(-1)
    expect(returnAt).toBeGreaterThan(-1)
    expect(hookAt).toBeLessThan(returnAt)
  })

  it('keeps every useState before the first early return', () => {
    const text = body()
    const returnAt = firstEarlyReturn(text)
    const after = text.slice(returnAt)
    // no state hook may follow an early return
    expect(after).not.toMatch(/^\s*const \[[a-zA-Z]+, set[a-zA-Z]+\] = useState/m)
  })
})
