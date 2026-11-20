import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentOwnerType,
  type DocumentType
} from '../../../../main/api/schemas/document.schema'
import { DocumentTable } from './DocumentTable'
import { ALL, filterRelated, relatedCategories } from './documentLinks'
import { t } from '../../../../main/i18n/translate'

/** From this many documents on the list starts folded and offers a search */
const FOLD_FROM = 6

/**
 * „Verträge & Dokumente“: files of other records that concern this one – assigned to it
 * („Zuordnen“) or filed at one of its events (the promoter's, the contact's, the venue's).
 * Folds away when the list is long; search and category narrow it.
 */
export function RelatedDocumentsSection({ kind, id }: { kind: DocumentOwnerType; id: number }) {
  const query = trpcReact.document.related.useQuery({ kind, id })
  const rows = useMemo(() => query.data ?? [], [query.data])
  const [openState, setOpen] = useState<boolean | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>(ALL)

  const categories = useMemo(() => relatedCategories(rows), [rows])
  const shown = useMemo(() => filterRelated(rows, { search, category }), [rows, search, category])
  const contracts = rows.filter((row) => row.documentType === 'contract').length

  if (query.isLoading || (query.isSuccess && rows.length === 0)) return null
  // short lists are open, long ones folded until opened
  const open = openState ?? rows.length < FOLD_FROM
  const filtered = search.trim() !== '' || category !== ALL

  return (
    <section aria-label={t('Verträge & Dokumente')} className="space-y-3">
      <button
        type="button"
        className="flex items-center gap-1.5 text-left font-semibold"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('Verträge & Dokumente')}
        <span className="font-normal text-muted-foreground">
          {filtered
            ? t('({{shown}} von {{total}})', { shown: shown.length, total: rows.length })
            : `(${rows.length})`}
          {contracts > 0 &&
            ` · ${contracts === 1 ? t('1 Vertrag') : t('{{count}} Verträge', { count: contracts })}`}
        </span>
      </button>
      {open && (
        <>
          <p className="text-sm text-muted-foreground">
            {t(
              'Zugeordnete Dateien und Dateien der Events, an denen dieser Eintrag beteiligt ist. Sie liegen dort, wo sie abgelegt wurden (Spalte „Quelle“).'
            )}
          </p>
          {rows.length >= FOLD_FROM && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-64"
                placeholder={t('Suchen: Name, Event, Firma…')}
                aria-label={t('Verträge & Dokumente durchsuchen')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 w-44" aria-label={t('Nach Kategorie filtern')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('Alle Kategorien')}</SelectItem>
                  {categories.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DOCUMENT_TYPE_LABELS[value as DocumentType] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DocumentTable
            rows={shown.map((doc) => ({
              doc,
              event: { ...doc.source, via: doc.via }
            }))}
            label={t('Verträge & Dokumente')}
            empty={t('Keine Dokumente für diese Auswahl.')}
            error={query.error}
            onRetry={() => void query.refetch()}
            readOnly
            onChanged={() => void query.refetch()}
          />
        </>
      )}
    </section>
  )
}
