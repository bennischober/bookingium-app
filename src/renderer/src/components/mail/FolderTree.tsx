import { useState } from 'react'
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
  onSelect
}: {
  folder: FolderNode
  depth: number
  selectedId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}) {
  const open = expanded.has(folder.id)
  const label = folderLabel(folder)

  return (
    <li>
      <div
        className={cn(
          'flex items-center rounded-md text-sm hover:bg-muted',
          selectedId === folder.id && 'bg-muted font-medium'
        )}
        style={{ paddingLeft: depth * 12 }}
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
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Folder tree; subfolders start collapsed (mailboxes can have hundreds) */
export function FolderTree({
  folders,
  selectedId,
  onSelect
}: {
  folders: FolderNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <ul aria-label="Ordner" className="space-y-px">
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}
