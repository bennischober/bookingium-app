import { Paperclip, X } from 'lucide-react'
import type { ComposeState } from './composeDraft'
import { formatSize } from './format'

/** The files that go with the mail: the invoice PDF, added files and forwarded ones */
export function ComposeAttachmentList({
  mail,
  invoice,
  update
}: {
  mail: ComposeState
  /** C1/I7: main attaches the invoice PDF on send; the window knows only its name */
  invoice?: { token: string; attachmentName: string }
  update: (patch: Partial<ComposeState>) => void
}) {
  return (
    <>
      {(mail.attachments.length > 0 ||
        mail.forwardedNames.length > 0 ||
        invoice?.attachmentName) && (
        <ul className="flex flex-wrap gap-1 border-b px-4 py-2 text-sm" aria-label="Anhänge">
          {invoice?.attachmentName && (
            <li
              className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"
              title="Wird beim Senden angehängt"
            >
              <Paperclip className="size-3" />
              <span className="max-w-56 truncate">{invoice.attachmentName}</span>
            </li>
          )}
          {mail.attachments.map((a, i) => (
            <li key={i} className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
              <Paperclip className="size-3" />
              <span className="max-w-56 truncate">{a.filename}</span>
              <span className="text-xs text-muted-foreground">
                {formatSize(Math.floor((a.base64.length * 3) / 4))}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => update({ attachments: mail.attachments.filter((_, j) => j !== i) })}
                aria-label={`${a.filename} entfernen`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
          {mail.forwardedNames.map((name, i) => (
            <li
              key={`fwd-${i}`}
              className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"
              title="Aus der weitergeleiteten E-Mail"
            >
              <Paperclip className="size-3" />
              <span className="max-w-56 truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
