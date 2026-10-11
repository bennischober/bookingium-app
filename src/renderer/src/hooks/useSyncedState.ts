import { useState } from 'react'

/**
 * Mirrors a (primitive) prop or query value into local state, re-syncing
 * during render when the source changes - the pattern recommended by React
 * ("You Might Not Need an Effect") instead of a setState-in-effect.
 *
 * Use for editable form state that must follow server data refreshes.
 * Values are compared with Object.is; only use with primitives/null.
 */
export function useSyncedState<T>(value: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  if (prevValue !== value) {
    setPrevValue(value)
    setState(value)
  }

  return [state, setState]
}
