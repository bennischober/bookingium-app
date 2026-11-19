import type { Dispatch, SetStateAction } from 'react'
import type { UseInfiniteQueryResult, UseQueryResult } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { useMailSearch } from '@/hooks/useMailSearch'
import { MailSearchBar } from './MailSearchBar'
import { MessageList, type QuickActions } from './MessageList'
import { type MailActions, MessageMenu } from './MessageMenu'
import { ThreadList } from './ThreadList'
import type { Selection } from './selection'
import { folderLabel } from './format'
import type {
  FolderNode,
  MessageListItem,
  SyncStatus,
  ThreadSummary
} from '../../../../main/mailclient/core/types'

/**
 * The mail page's list pane: the folder picker of narrow windows, the search bar and the list of
 * the open folder, its threads or the search hits
 */
export function MailListPane({
  listWidth,
  folderId,
  allFolders,
  chooseFolder,
  search,
  threads,
  setThreads,
  listLoading,
  messages,
  threadList,
  listItems,
  selection,
  changeSelection,
  canWrite,
  openWindow,
  selectedItems,
  selectedActions,
  quickActions,
  setMovingFolder,
  setDragged,
  syncStatus
}: {
  listWidth: number
  folderId: string | null
  allFolders: FolderNode[]
  chooseFolder: (id: string) => void
  search: ReturnType<typeof useMailSearch>
  threads: boolean
  setThreads: Dispatch<SetStateAction<boolean>>
  listLoading: boolean
  messages: UseInfiniteQueryResult<MessageListItem[]>
  threadList: UseInfiniteQueryResult<ThreadSummary[]>
  /** The open folder or the hits, without the rows hidden by a pending move */
  listItems: MessageListItem[]
  selection: Selection
  changeSelection: (next: Selection, how?: 'menu') => void
  canWrite: boolean
  openWindow: (id: number) => void
  selectedItems: MessageListItem[]
  selectedActions: MailActions
  /** #240: buttons on the row under the pointer */
  quickActions?: QuickActions
  setMovingFolder: (folder: FolderNode | null) => void
  setDragged: Dispatch<SetStateAction<MessageListItem[] | null>>
  syncStatus: UseQueryResult<SyncStatus>
}) {
  const { searching, results, snippets } = search
  return (
    <section
      // The reader keeps at least a third of the window
      className="flex max-w-[45vw] shrink-0 flex-col"
      style={{ width: listWidth }}
      aria-label="Postfachliste"
    >
      <div className="space-y-2 border-b p-2">
        {/* Narrow windows: a folder picker instead of the tree */}
        <Select value={folderId ?? undefined} onValueChange={(id) => chooseFolder(id as string)}>
          <SelectTrigger className="w-full lg:hidden" aria-label="Ordner wählen">
            <SelectValue placeholder="Ordner" />
          </SelectTrigger>
          <SelectContent>
            {allFolders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {folderLabel(f) === f.name ? f.path : folderLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MailSearchBar
          search={search}
          threads={threads}
          setThreads={setThreads}
          allFolders={allFolders}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {listLoading ? (
          <Spinner className="m-4" />
        ) : threads && !searching ? (
          // Search results are single mails; the thread switch is hidden meanwhile
          threadList.isLoading ? (
            <Spinner className="m-4" />
          ) : (
            <ThreadList
              threads={threadList.data?.pages.flat() ?? []}
              onOpen={openWindow}
              hasMore={Boolean(threadList.hasNextPage)}
              loadingMore={threadList.isFetchingNextPage}
              onLoadMore={() => void threadList.fetchNextPage()}
            />
          )
        ) : (
          <MessageList
            items={listItems}
            selection={selection}
            onSelectionChange={changeSelection}
            multiple={canWrite}
            onOpen={openWindow}
            onDelete={selectedActions.toTrash}
            quickActions={quickActions}
            onDragMessages={
              canWrite
                ? (mails) => {
                    // F6: a mail drag is never a folder move, whatever came before
                    if (mails) setMovingFolder(null)
                    setDragged(mails)
                  }
                : undefined
            }
            menu={
              <MessageMenu items={selectedItems} folders={allFolders} actions={selectedActions} />
            }
            snippets={searching ? snippets : undefined}
            hasMore={Boolean(searching ? results.hasNextPage : messages.hasNextPage)}
            loadingMore={searching ? results.isFetchingNextPage : messages.isFetchingNextPage}
            onLoadMore={() => void (searching ? results.fetchNextPage() : messages.fetchNextPage())}
            emptyText={
              searching
                ? 'Keine Treffer.'
                : syncStatus.data?.running
                  ? 'Wird synchronisiert…'
                  : 'Dieser Ordner ist leer.'
            }
          />
        )}
      </div>
    </section>
  )
}
