import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ChevronRight,
  FileText,
  Folder,
  Inbox,
  Send,
  ShieldAlert,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FolderNode } from '../../../../main/mailclient/core/types'
import { folderLabel, isInbox } from './format'

// Hovering a dragged mail over a closed folder opens it after this delay
const EXPAND_DELAY_MS = 700

/**
 * Set only while a mail from the list is dragged, so other drags (files)
 * are never taken. The drag data isn't checked: not every drag source
 * keeps a custom type.
 */
export type FolderDrop = {
  canDrop: (folder: FolderNode) => boolean
  onDrop: (folder: FolderNode) => void
}

const SPECIAL_ICONS: Array<[string, LucideIcon]> = [
  ['Drafts', FileText],
  ['Sent', Send],
  ['Archive', Archive],
  ['Junk', ShieldAlert],
  ['Trash', Trash2]
]

function FolderIcon({ folder }: { folder: FolderNode }) {
  const props = { className: 'size-4 shrink-0 text-muted-foreground' }
  if (isInbox(folder)) return <Inbox {...props} />
  const special = SPECIAL_ICONS.find(([use]) => folder.specialUse?.includes(use))
  const Icon = special ? special[1] : Folder
  return <Icon {...props} />
}

function FolderItem({
  folder,
  depth,
  selectedId,
  expanded,
  onToggle,
  onExpand,
  onSelect,
  drop,
  overId,
  onOver
}: {
  folder: FolderNode
  depth: number
  selectedId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onExpand: (id: string) => void
  onSelect: (id: string) => void
  drop?: FolderDrop
  overId: string | null
  /** Marks the folder under the dragged mail; leaving clears only its own mark */
  onOver: (id: string, over: boolean) => void
}) {
  const open = expanded.has(folder.id)
  const label = folderLabel(folder)
  const accepts = drop?.canDrop(folder) ?? false
  const over = drop !== undefined && overId === folder.id

  // Open a closed folder while a mail hovers over it
  const expandTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const stopExpand = () => clearTimeout(expandTimer.current)
  useEffect(() => stopExpand, [])

  const dropProps = drop && {
    onDragEnter: () => {
      onOver(folder.id, true)
      stopExpand()
      if (!open && folder.children.length > 0) {
        expandTimer.current = setTimeout(() => onExpand(folder.id), EXPAND_DELAY_MS)
      }
    },
    onDragOver: (event: React.DragEvent) => {
      // Without preventDefault the browser refuses the drop
      event.preventDefault()
      event.dataTransfer.dropEffect = accepts ? 'move' : 'none'
    },
    onDragLeave: (event: React.DragEvent) => {
      // Moving onto a child element also fires dragleave
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      stopExpand()
      onOver(folder.id, false)
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      stopExpand()
      onOver(folder.id, false)
      if (accepts) drop.onDrop(folder)
    }
  }

  return (
    <li>
      <div
        className={cn(
          'flex items-center rounded-md text-sm hover:bg-muted',
          selectedId === folder.id && 'bg-muted font-medium',
          over && accepts && 'bg-primary/15 ring-2 ring-primary/60 ring-inset'
        )}
        style={{ paddingLeft: depth * 12 }}
        data-drop-target={over && accepts ? 'true' : undefined}
        {...dropProps}
      >
        {folder.children.length > 0 ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
            onClick={() => onToggle(folder.id)}
            aria-label={open ? `${label} zuklappen` : `${label} aufklappen`}
            aria-expanded={open}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left"
          onClick={() => onSelect(folder.id)}
          title={folder.path}
          aria-current={selectedId === folder.id ? 'true' : undefined}
        >
          <FolderIcon folder={folder} />
          <span className="truncate">{label}</span>
          {folder.unreadCount > 0 && (
            <span className="ml-auto text-xs font-semibold text-primary">{folder.unreadCount}</span>
          )}
        </button>
      </div>
      {open && folder.children.length > 0 && (
        <ul>
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onExpand={onExpand}
              onSelect={onSelect}
              drop={drop}
              overId={overId}
              onOver={onOver}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Folder tree; subfolders start collapsed (mailboxes can have hundreds).
 * With `drop` set, mails dragged from the list can be dropped on folders.
 */
export function FolderTree({
  folders,
  selectedId,
  onSelect,
  drop,
  focusRef
}: {
  folders: FolderNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  drop?: FolderDrop
  /** B3: the move shortcut puts the keyboard on the tree, which is the drop target */
  focusRef?: React.RefObject<HTMLUListElement | null>
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [overId, setOverId] = useState<string | null>(null)
  // A drag that ended elsewhere leaves no highlight behind
  if (!drop && overId !== null) setOverId(null)
  const expand = (id: string) => setExpanded((prev) => new Set(prev).add(id))
  // Entering the next folder can come before leaving the last one
  const markOver = (id: string, over: boolean) =>
    setOverId((current) => (over ? id : current === id ? null : current))
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <ul aria-label="Ordner" className="space-y-px" ref={focusRef} tabIndex={-1}>
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          onToggle={toggle}
          onExpand={expand}
          onSelect={onSelect}
          drop={drop}
          overId={overId}
          onOver={markOver}
        />
      ))}
    </ul>
  )
}
