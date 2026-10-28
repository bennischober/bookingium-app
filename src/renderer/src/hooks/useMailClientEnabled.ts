import { trpcReact } from '@/lib/trpc'

/**
 * The "E-Mail (experimentell)" setting. Off (and while the settings load), the renderer shows
 * none of the mail client: no menu entry, no E-Mails tabs, no mail search, no own editor.
 */
export function useMailClientEnabled(): boolean {
  return trpcReact.settings.get.useQuery().data?.mailClient === true
}
