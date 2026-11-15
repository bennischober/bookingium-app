import { unreadBadgeLabel } from './unreadBadge'

/** "· 6 ungelesen" after an account in the picker or a collapsed section; nothing when all is read */
export function UnreadCount({ unread }: { unread: number | undefined }) {
  if (!unread) return null
  return (
    <span className="ml-1.5 text-xs text-muted-foreground" title="Ungelesen im Posteingang">
      · {unreadBadgeLabel(unread)} ungelesen
    </span>
  )
}
