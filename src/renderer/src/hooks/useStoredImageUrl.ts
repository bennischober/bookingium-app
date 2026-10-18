import { useEffect, useState } from 'react'

// Resolves a stored relative image path to a data URL via IPC (null if empty/missing)
export function useStoredImageUrl(relativePath: string | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string | null }>({
    path: '',
    url: null
  })

  const path = relativePath ?? ''

  // Reset synchronously during render when the path changes; async IPC load
  // stays in an effect (state adjustment pattern, per "You Might Not Need an
  // Effect")
  if (resolved.path !== path) {
    setResolved({ path, url: null })
  }

  useEffect(() => {
    if (!path) return
    let active = true
    void window.api.getLogoPath(path).then((result) => {
      if (!active) return
      if (result.success && result.dataUrl) {
        setResolved({ path, url: result.dataUrl })
      }
    })
    return () => {
      active = false
    }
  }, [path])

  return resolved.url
}
