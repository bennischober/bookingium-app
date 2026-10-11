import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={isDark ? 'Zum hellen Farbschema wechseln' : 'Zum dunklen Farbschema wechseln'}
      title={isDark ? 'Zum hellen Farbschema wechseln' : 'Zum dunklen Farbschema wechseln'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="size-8 cursor-pointer"
    >
      {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  )
}
