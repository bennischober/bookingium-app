import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Link2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import type { MessageDetail } from '../../../../main/mailclient/core/types'
import { t } from '../../../../main/i18n/translate'

/** Every link of the mail with its real address; unsafe ones cannot be opened */
function LinkList({ message }: { message: MessageDetail }) {
  const [open, setOpen] = useState(false)
  // Copying is silent otherwise; a toast is the only feedback that it happened
  const copyLink = async (url: string): Promise<void> => {
    const result = await window.api.copyMailLink(url)
    if (result.success) toast.success(t('Link-Adresse kopiert'))
    else toast.error(t('Kopieren fehlgeschlagen'), { description: result.error })
  }
  if (message.links.length === 0) return null
  return (
    <footer className="max-h-[40%] shrink-0 overflow-auto border-t px-4 py-2 text-sm">
      <button
        type="button"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <Link2 className="size-4" />
        {message.links.length} {message.links.length === 1 ? t('Link') : t('Links')}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {message.links.map((link) => (
            <li key={link.index} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate">{link.text || t('(ohne Text)')}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={link.url}>
                  {link.url}
                </p>
              </div>
              {link.openable ? (
                <ButtonGroup className="shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    // The main process opens it in the default browser
                    onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                  >
                    {t('Öffnen')}
                  </Button>
                  {/* F16: copy instead of open - for pasting into another browser or an incognito
                      window, which opening in the default browser cannot do. The clipboard lives in
                      the main process, so this goes through window.api. */}
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title={t('Link-Adresse kopieren')}
                    aria-label={t('Link-Adresse kopieren: {{url}}', { url: link.url })}
                    onClick={() => void copyLink(link.url)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </ButtonGroup>
              ) : (
                <span className="text-xs text-destructive">
                  {t('Gesperrt (')}
                  {link.scheme || '?'})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </footer>
  )
}

/**
 * The mail's content. HTML mail is already sanitized by the core and shown in a
 * sandboxed iframe; plain text goes in a <pre>. The link list follows below it.
 */
export function MessageBody({ message }: { message: MessageDetail }) {
  return (
    <>
      {message.bodyKind === 'html' && message.html ? (
        <iframe
          // No allow-scripts, no allow-same-origin: the mail cannot run code
          // or reach the app. Links open as popups, which the main process
          // hands to the default browser.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={message.html}
          title={t('Inhalt der E-Mail')}
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-sans text-sm whitespace-pre-wrap">
          {message.text}
        </pre>
      )}

      <LinkList message={message} />
    </>
  )
}
