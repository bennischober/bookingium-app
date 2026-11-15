import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageErrorState } from '@/components/load-states'
import { DeleteRecordButton } from '@/components/detail/DeleteRecordButton'
import { TabCount } from '@/components/detail/DetailParts'
import { emptyTabClass } from '@/components/detail/tabStyles'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { MailHistoryPanel } from '@/components/mail/MailHistoryPanel'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { useDetailTab } from '@/hooks/useDetailTab'
import { useHasMailAccount } from '@/hooks/useHasMailAccount'
import { deleteQuestion } from '@/lib/recordCopy'
import { isNotFound, type QueryError } from '@/lib/queryErrors'
import type { DocumentOwnerType } from '../../../../main/api/schemas/document.schema'

/**
 * #172: the skeleton every record detail page shares (band, company, person, venue).
 *
 * `RecordDetailPage` shows loading, error and not found, and renders its child once
 * the record is there; `RecordDetail` is the loaded page: back link, header with
 * follow-up, edit and delete, the follow-ups, and the tabs. A page declares its tabs
 * as a list; Dokumente and E-Mails are appended here.
 *
 * ```tsx
 * <RecordDetailPage id={id} query={band} loading="Band wird geladen…" notFound={…}>
 *   {(band) => (
 *     <RecordDetail record={{ type: 'band', id: band.id, name: band.name }} isTab={isBandTab}
 *       tabs={[{ id: 'overview', label: 'Übersicht', content: <OverviewTab band={band} /> }]} …>
 *       <FormSheet …>…</FormSheet>
 *     </RecordDetail>
 *   )}
 * </RecordDetailPage>
 * ```
 */

interface RecordQuery<T> {
  data: T | null | undefined
  isLoading: boolean
  isError: boolean
  error: QueryError
  refetch: () => unknown
}

export function RecordDetailPage<T>({
  id,
  query,
  loading,
  notFound,
  children
}: {
  /** The id from the URL; `null` (not a number) never loads and is not found */
  id: number | null
  /** The record's `getById` query */
  query: RecordQuery<T>
  /** "Band wird geladen…" */
  loading: string
  /** "Band nicht gefunden." and the way back: "Zurück zu den Bands" */
  notFound: { text: string; backLabel: string; onBack: () => void }
  children: (record: T) => ReactNode
}) {
  // A bad id never loads (the query stays disabled), it is not found
  if (id !== null && query.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">{loading}</p>
      </div>
    )
  }

  if (query.isError && !isNotFound(query.error)) {
    return <PageErrorState error={query.error} onRetry={() => void query.refetch()} />
  }

  if (!query.data) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{notFound.text}</p>
        <Button variant="outline" onClick={notFound.onBack}>
          {notFound.backLabel}
        </Button>
      </div>
    )
  }

  return children(query.data)
}

/** One tab of a detail page */
export interface DetailTab<TTab extends string = string> {
  /** The `?tab=` value; the page's `is<X>Tab()` guard knows it */
  id: TTab
  label: string
  /** Row count after the label (`useXTabCounts`) */
  count?: number
  /** Width of the tab content, e.g. `max-w-2xl` for a card list */
  className?: string
  content: ReactNode
}

export function RecordDetail<TTab extends string>({
  record,
  back,
  subtitle,
  onEdit,
  onDelete,
  deleting,
  isTab,
  tabs,
  documents,
  children
}: {
  /** The record as follow-ups, documents and mails know it; `name` is the page title */
  record: { type: DocumentOwnerType; id: number; name: string }
  /** "Alle Bands" and where it leads */
  back: { label: string; onBack: () => void }
  subtitle?: ReactNode
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
  /** The route's tab guard (`components/<obj>/constants.ts`); the first tab is the default */
  isTab: (value: unknown) => value is TTab
  /** The page's own tabs, without Dokumente and E-Mails */
  tabs: DetailTab<TTab>[]
  /** The Dokumente tab: its count, the panel's title and anything shown below the panel */
  documents: { count: number | undefined; title: string; extra?: ReactNode }
  /** The edit sheet and other overlays */
  children?: ReactNode
}) {
  const navigate = useNavigate()
  const hasMailAccount = useHasMailAccount()
  const fallback = tabs[0].id
  const activeTab = useDetailTab(isTab, fallback)
  const followUpRecord = { type: record.type, id: record.id, name: record.name }

  const allTabs: DetailTab[] = [
    ...tabs,
    {
      id: 'documents',
      label: 'Dokumente',
      count: documents.count,
      className: 'space-y-8',
      content: (
        <>
          <DocumentsPanel ownerType={record.type} ownerId={record.id} title={documents.title} />
          {documents.extra}
        </>
      )
    },
    ...(hasMailAccount
      ? [
          {
            id: 'mails',
            label: 'E-Mails',
            content: <MailHistoryPanel entityType={record.type} entityId={record.id} />
          }
        ]
      : [])
  ]

  return (
    <div className="flex h-full w-full min-w-0 flex-col p-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={back.onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          {back.label}
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{record.name}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2">
            <FollowUpButton record={followUpRecord} />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>
            <DeleteRecordButton
              confirmTitle={deleteQuestion(record.name)}
              pending={deleting}
              onDelete={onDelete}
            />
          </div>
        </div>
      </div>

      <RecordFollowUps record={followUpRecord} />

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries. The shell serves
          // several routes, so the router cannot type this search; `isTab` is the route's guard.
          navigate({
            to: '.',
            search: { tab: isTab(tab) && tab !== fallback ? tab : undefined } as never,
            replace: true
          })
        }
        className="flex-1"
      >
        {/* Tabs wrap onto a second row in narrow windows */}
        <TabsList className="mb-6 h-auto max-w-full flex-wrap justify-start">
          {allTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className={emptyTabClass(tab.count)}>
              {tab.label}
              <TabCount count={tab.count} />
            </TabsTrigger>
          ))}
        </TabsList>

        {allTabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className={tab.className}>
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>

      {children}
    </div>
  )
}
