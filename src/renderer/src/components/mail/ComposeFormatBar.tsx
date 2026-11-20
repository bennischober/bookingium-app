import type { RefObject } from 'react'
import { Bold, FileText, Italic, List, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ComposeFormat } from './composeBody'
import { t } from '../../../../main/i18n/translate'

/** F3: the four commands the toolbar offers, and nothing that carries a URL or CSS */
const FORMAT_BUTTONS: { format: ComposeFormat; label: string; Icon: typeof Bold }[] = [
  { format: 'bold', label: t('Fett'), Icon: Bold },
  { format: 'italic', label: t('Kursiv'), Icon: Italic },
  { format: 'underline', label: t('Unterstrichen'), Icon: Underline },
  { format: 'insertUnorderedList', label: t('Aufzählung'), Icon: List }
]

export function ComposeFormatBar({
  body,
  onBodyInput,
  locked,
  openTemplates
}: {
  /** The contenteditable the commands apply to */
  body: RefObject<HTMLDivElement | null>
  onBodyInput: () => void
  locked: boolean
  openTemplates: () => void
}) {
  // F3: lightweight formatting. The body is HTML, but the plain text stays
  // the source of truth: composeBody derives it on every edit, so search and
  // snippets keep reading the text.
  return (
    <div className="flex shrink-0 gap-1 border-b px-2 py-1">
      {FORMAT_BUTTONS.map(({ format, label, Icon }) => (
        <Button
          key={format}
          type="button"
          variant="ghost"
          size="icon-sm"
          title={label}
          aria-label={label}
          // The selection must survive the click: the button is not inside the
          // editable, so the browser would move the caret and the command would
          // have nothing to format
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            body.current?.focus()
            document.execCommand(format)
            onBodyInput()
          }}
        >
          <Icon />
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto"
        disabled={locked}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openTemplates}
      >
        <FileText />
        {t('Vorlage einfügen')}
      </Button>
    </div>
  )
}
