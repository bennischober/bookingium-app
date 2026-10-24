import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  Pencil,
  Send,
  ShieldAlert,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuSeparator,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import type { FolderNode } from '../../../../main/mailclient/core/types'
import { folderLabel, isInbox, isTrash, FOLDER_DRAG_TYPE } from './format'
import { isProtectedFolder } from '../../../../main/mailclient/core/folders'

// Hovering a dragged mail over a closed folder opens it after this delay
const EXPAND_DELAY_MS = 700

/**
 * Set only while a mail from the list is dragged, so other drags (files)
 * are never taken. The drag data isn't checked: not every drag source
 * keeps a custom type.
 */
/** B1: what the folder context menu offers */
export type FolderAction = 'create' | 'rename' | 'delete'

const isProtected = (folder: FolderNode): boolean =>
  isProtectedFolder({ path: folder.path, specialUse: folder.specialUse })

export type FolderDrop = {
  canDrop: (folder: FolderNode) => boolean
  onDrop: (folder: FolderNode) => void
}

/** B2: dropping a dragged folder onto another one, or onto the root level */
export type FolderMoveDrop = {
  canMove: (target: FolderNode | null) => boolean
  onMove: (target: FolderNode | null) => void
  /** the drag starts on a folder row, so the page knows what is being moved */
  onDragStart?: (folder: FolderNode) => void
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
  folderMove,
  overId,
  onOver,
  onEmptyTrash,
  onFolderAction
}: {
  folder: FolderNode
  depth: number
  selectedId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onExpand: (id: string) => void
  onSelect: (id: string) => void
  drop?: FolderDrop
  /** B2: dropping a dragged folder here, or onto the root level */
  folderMove?: FolderMoveDrop
  overId: string | null
  /** Marks the folder under the dragged mail; leaving clears only its own mark */
  onOver: (id: string, over: boolean) => void
  /** B5: "Papierkorb leeren" - only passed for a writable account */
  onEmptyTrash?: (folder: FolderNode) => void
  /** B1: create / rename / delete - only passed for a writable account */
  onFolderAction?: (action: FolderAction, folder: FolderNode | null) => void
}) {
  const open = expanded.has(folder.id)
  const label = folderLabel(folder)
  const accepts = drop?.canDrop(folder) ?? false
  const over = drop !== undefined && overId === folder.id
  // B2: a folder dragged over this row would land inside it
  const acceptsFolder = folderMove?.canMove(folder) ?? false

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

  // B2: the folder itself is the drag source, and every row a drop target for both
  // a dragged mail and a dragged folder. The two share one onDragOver/onDrop pair:
  // React keeps only the last prop, so separate objects would silently drop one.
  const folderDragProps = onFolderAction &&
    !isProtected(folder) && {
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.path)
        event.dataTransfer.effectAllowed = 'move'
        folderMove?.onDragStart?.(folder)
      }
    }
  const rowDropProps = (drop || folderMove) && {
    onDragEnter: drop && (() => dropProps!.onDragEnter()),
    onDragLeave: drop && ((event: React.DragEvent) => dropProps!.onDragLeave(event)),
    onDragOver: (event: React.DragEvent) => {
      // A dragged folder wins: it is the one being moved right now
      if (acceptsFolder) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        return
      }
      dropProps?.onDragOver(event)
    },
    onDrop: (event: React.DragEvent) => {
      if (acceptsFolder) {
        event.preventDefault()
        folderMove!.onMove(folder)
        return
      }
      dropProps?.onDrop(event)
    }
  }

  const row = (
    <div
      className={cn(
        'flex items-center rounded-md text-sm hover:bg-muted',
        selectedId === folder.id && 'bg-muted font-medium',
        over && accepts && 'bg-primary/15 ring-2 ring-primary/60 ring-inset'
      )}
      style={{ paddingLeft: depth * 12 }}
      data-drop-target={over && accepts ? 'true' : undefined}
      {...folderDragProps}
      {...rowDropProps}
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
  )

  return (
    <li>
      {/* B5: emptying Trash is the only folder action so far, so only it gets a menu */}
      {(onEmptyTrash && isTrash(folder)) || onFolderAction ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            {/* B1: a plain folder may be renamed and deleted; INBOX and the
                special-use folders never may, so the items are hidden there */}
            {onFolderAction && !isProtected(folder) && (
              <>
                <ContextMenuItem className="gap-2" onSelect={() => onFolderAction('rename', folder)}>
                  <Pencil className="size-4 shrink-0 text-muted-foreground" />
                  Umbenennen…
                </ContextMenuItem>
                <ContextMenuItem className="gap-2" onSelect={() => onFolderAction('delete', folder)}>
                  <Trash2 className="size-4 shrink-0 text-muted-foreground" />
                  Löschen…
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {onFolderAction && (
              <ContextMenuItem className="gap-2" onSelect={() => onFolderAction('create', folder)}>
                <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                Neuer Ordner…
              </ContextMenuItem>
            )}
            {onEmptyTrash && isTrash(folder) && (
              <ContextMenuItem className="gap-2" onSelect={() => onEmptyTrash(folder)}>
                <Trash2 className="size-4 shrink-0 text-muted-foreground" />
                Papierkorb leeren
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
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
              folderMove={folderMove}
              overId={overId}
              onOver={onOver}
              onEmptyTrash={onEmptyTrash}
              onFolderAction={onFolderAction}
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
  folderMove,
  focusRef,
  onEmptyTrash,
  onFolderAction
}: {
  folders: FolderNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  drop?: FolderDrop
  /** B2: dropping a dragged folder onto the tree moves it to the root level */
  folderMove?: FolderMoveDrop
  /** B3: the move shortcut puts the keyboard on the tree, which is the drop target */
  focusRef?: React.RefObject<HTMLUListElement | null>
  /** B5: emptying the Trash, offered only for a writable account */
  onEmptyTrash?: (folder: FolderNode) => void
  /** B1: create / rename / delete, offered only for a writable account */
  onFolderAction?: (action: FolderAction, folder: FolderNode | null) => void
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
          folderMove={folderMove}
          overId={overId}
          onOver={markOver}
          onEmptyTrash={onEmptyTrash}
          onFolderAction={onFolderAction}
        />
      ))}
    </ul>
  )
}
