import { useCallback, useState } from 'react'

export type WidthBounds = { min: number; max: number }

export const clampWidth = (value: number, { min, max }: WidthBounds) =>
  Math.round(Math.min(max, Math.max(min, value)))

/**
 * A pane width in pixels, remembered across restarts. Storage can be
 * unavailable or hold junk; the default is used then.
 */
export function useStoredWidth(key: string, initial: number, bounds: WidthBounds) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key))
      return stored > 0 ? clampWidth(stored, bounds) : initial
    } catch {
      return initial
    }
  })
  const save = useCallback(
    (next: number) => {
      setWidth(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // Only a convenience; the width just isn't kept
      }
    },
    [key]
  )
  return [width, save] as const
}
