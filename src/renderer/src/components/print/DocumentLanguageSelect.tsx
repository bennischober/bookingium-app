import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

/** The languages every outgoing document prints in (invoices, contracts) */
export type DocumentLang = 'de' | 'en'

const DOCUMENT_LANGUAGES: ReadonlyArray<{ value: DocumentLang; label: string }> = [
  { value: 'de', label: 'Deutsch (DE)' },
  { value: 'en', label: 'Englisch (EN)' }
]

// Looks like the outline buttons of the print toolbar
export const TOOLBAR_SELECT_CLASS =
  'h-8 rounded-lg border-border bg-background font-medium shadow-none hover:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50'

/**
 * The document language of a print page. The document, its file name and the email it is
 * sent with follow it; the UI language has nothing to do with it.
 */
export function DocumentLanguageSelect({
  value,
  onChange
}: {
  value: DocumentLang
  onChange: (lang: DocumentLang) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as DocumentLang)}>
      <SelectTrigger
        className={`w-[150px] ${TOOLBAR_SELECT_CLASS}`}
        aria-label="Sprache des Dokuments"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DOCUMENT_LANGUAGES.map((language) => (
          <SelectItem key={language.value} value={language.value}>
            {language.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
