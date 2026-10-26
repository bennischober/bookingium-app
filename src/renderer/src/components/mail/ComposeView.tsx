import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, List, Paperclip, Send, Trash2, Underline, X } from 'lucide-react'
import { toast } from 'sonner'
import { mailApi } from '@/lib/mailApi'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  type Address,
  type ComposeState,
  addressProblem,
  isValidEmail,
  parseAddress,
  toDraftInput
} from './composeDraft'
import { formatSize } from './format'
import { attachmentsFit, MAX_ATTACHMENT_BYTES, pasteContent } from './composeDraft'
import { composeBody, toEditorHtml, type ComposeFormat } from './composeBody'
import {
  type SendPhase,
  createSendGate,
  draftSaveAllowed,
  findSessionSend,
  isUnclearSend,
  recipientKeyAction,
  unclearCheck
} from './composeSend'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : undefined)

/**
 * F5: how long typing pauses before the draft is stored. Short enough that a
 * reload or a close loses at most the last keystrokes, long enough that a
 * sentence does not save per character.
 */
const AUTOSAVE_MS = 1500

/** G8: where a recipient suggestion came from, in the dropdown */
const SOURCE_LABELS: Record<'person' | 'company' | 'venue' | 'mail', string> = {
  person: 'Kontakt',
  company: 'Firma',
  venue: 'Spielstätte',
  mail: 'Aus E-Mails'
}

/** F3: the four commands the toolbar offers, and nothing that carries a URL or CSS */
const FORMAT_BUTTONS: { format: ComposeFormat; label: string; Icon: typeof Bold }[] = [
  { format: 'bold', label: 'Fett', Icon: Bold },
  { format: 'italic', label: 'Kursiv', Icon: Italic },
  { format: 'underline', label: 'Unterstrichen', Icon: Underline },
  { format: 'insertUnorderedList', label: 'Aufzählung', Icon: List }
]

/** Recipients as chips; typed text becomes one on Enter, comma or leaving the field */
function RecipientField({
  label,
  accountId,
  value,
  onChange,
  autoFocus
}: {
  label: string
  accountId: string
  value: Address[]
  onChange: (value: Address[]) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const query = useDebounced(text.trim(), 150)
  // G8: the app's own records are searched too, not only addresses seen in mail. A person you have
  // on file but never mailed was invisible here, which is the case the lookup exists for. The merge
  // happens in main (the dependency-free mail core cannot read the app database) and arrives ranked.
  const contacts = trpcReact.mail.contacts.useQuery(
    { query, accountId },
    { enabled: query.length >= 2, keepPreviousData: true }
  )
  const taken = new Set(value.map((a) => a.email.toLowerCase()))
  const suggestions =
    focused && text.trim().length >= 2
      ? (contacts.data ?? []).filter((c) => !taken.has(c.email.toLowerCase())).slice(0, 8)
      : []

  const add = (addresses: Address[]) => {
    const fresh = addresses.filter((a) => a.email && !taken.has(a.email.toLowerCase()))
    if (fresh.length) onChange([...value, ...fresh])
    setText('')
    setActive(0)
  }
  const commit = () => {
    const parts = text.split(/[,;]/).filter((p) => p.trim())
    if (parts.length) add(parts.map(parseAddress))
  }

  return (
    <div className="relative flex items-start gap-2 border-b px-4 py-1.5 text-sm">
      <span className="w-12 shrink-0 pt-1 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((a) => {
          const valid = isValidEmail(a.email)
          // G12: the reason, not just "invalid" - the guard knows which part is wrong
          const problem = valid ? null : addressProblem(a.email)
          return (
            <span
              key={a.email}
              className={cn(
                'flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5',
                valid ? 'bg-muted' : 'bg-destructive/10 text-destructive'
              )}
              title={valid ? a.email : (addressProblem(a.email) ?? 'Keine gültige Adresse')}
            >
              <span className="truncate">{a.name || a.email}</span>
              {problem ? (
                <span className="text-xs opacity-80" data-testid="address-problem">
                  {problem}
                </span>
              ) : null}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(value.filter((x) => x !== a))}
                aria-label={`${a.email} entfernen`}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          className="min-w-32 flex-1 bg-transparent py-0.5 outline-none"
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text')
            if (!/[,;\n]/.test(pasted)) return
            e.preventDefault()
            add(
              pasted
                .split(/[,;\n]/)
                .filter((p) => p.trim())
                .map(parseAddress)
            )
          }}
          onKeyDown={(e) => {
            // Ctrl+Enter is the editor's send shortcut and goes on to the form
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return
            const action = recipientKeyAction(e.key, {
              text,
              hasSuggestions: suggestions.length > 0,
              hasRecipients: value.length > 0
            })
            if (action === 'navigate') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i + step + suggestions.length) % suggestions.length)
            } else if (action === 'pick') {
              e.preventDefault()
              add([suggestions[Math.min(active, suggestions.length - 1)]])
            } else if (action === 'commit') {
              e.preventDefault()
              commit()
            } else if (action === 'swallow') {
              // I2 (MR-04): an Enter in an empty field used to fall through to the form
              e.preventDefault()
            } else if (action === 'removeLast') {
              onChange(value.slice(0, -1))
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <ul
          className="absolute top-full right-4 left-16 z-10 mt-1 overflow-hidden rounded-md border bg-popover shadow-md"
          role="listbox"
          aria-label="Vorschläge"
        >
          {suggestions.map((c, i) => (
            <li
              key={c.email}
              role="option"
              aria-selected={i === active}
              className={cn('cursor-pointer px-3 py-1.5', i === active && 'bg-muted')}
              // Before the input's blur, which would take the typed text as it is
              onMouseDown={(e) => {
                e.preventDefault()
                add([c])
              }}
              onMouseEnter={() => setActive(i)}
            >
              {c.name ? (
                <>
                  {c.name} <span className="text-muted-foreground">{c.email}</span>
                </>
              ) : (
                c.email
              )}
              {/* G8: why this address is here. A mail-history hit and an address-book record look
                  identical otherwise, and the user should know which one they are picking. */}
              <span className="ml-2 text-xs text-muted-foreground/70">
                {SOURCE_LABELS[c.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden'))
    reader.readAsDataURL(file)
  })
}

/**
 * Editor for a new mail, a reply, a forward or a saved draft, in the reading pane.
 * It saves to Drafts on request and when it is left with changes, and replaces the
 * saved version each time; sending removes it.
 */
export function ComposeView({
  accountId,
  initial,
  onClose,
  onStored,
  presetPdfPath,
  onSent
}: {
  accountId: string
  initial: ComposeState
  /** The editor is done (sent or discarded) */
  onClose: () => void
  /** Drafts or Sent changed */
  onStored: () => void
  /** C1: the PDF the window was opened with, read in main and attached on send */
  presetPdfPath?: string
  /** C1: the mail was sent, with its Message-ID */
  onSent?: (messageId: string) => void
}) {
  const [mail, setMail] = useState(initial)
  const [showCopies, setShowCopies] = useState(initial.cc.length > 0 || initial.bcc.length > 0)
  const [busy, setBusy] = useState<'send' | 'save' | 'discard' | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // F3: what the editor starts with. A plain text becomes paragraphs, so the
  // quote of a reply and the line breaks of a draft survive the first render.
  const initialBodyHtml = useRef(toEditorHtml(initial.bodyText, initial.bodyHtml)).current
  // F3: the starting HTML is written once, outside React. Re-applying it on every
  // render would wipe what the user typed back to the initial content.
  useEffect(() => {
    const el = body.current
    if (el && el.innerHTML !== initialBodyHtml) el.innerHTML = initialBodyHtml
  }, [initialBodyHtml])
  // A reply or forward is written above the quote, not after it: put the caret at
  // the very start, which is the first position of the contenteditable
  useEffect(() => {
    const el = body.current
    if (!el) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [])

  // Saves run one after another, each replacing the one before (see the core's saveDraft)
  const mailRef = useRef(mail)
  mailRef.current = mail
  const draftUid = useRef(initial.draftUid)
  const savedText = useRef(JSON.stringify(toDraftInput(initial)))
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const closed = useRef(false)
  const onStoredRef = useRef(onStored)
  onStoredRef.current = onStored

  // I2: the send phase is state for the render and a ref for the timers and handlers,
  // which would otherwise read the value of the render they were created in
  const [phase, setPhaseState] = useState<SendPhase>('idle')
  const phaseRef = useRef<SendPhase>('idle')
  const setPhase = (next: SendPhase) => {
    phaseRef.current = next
    setPhaseState(next)
  }
  const gate = useRef(createSendGate()).current
  // I2 (MR-03): one key per compose session. The core makes it the Message-ID, so a send
  // that is retried from this editor is the same mail and can be found in Sent.
  const sendKey = useRef(crypto.randomUUID())
  const locked = phase !== 'idle'

  // Draft saves only while idle (MR-38): see draftSaveAllowed
  const isDirty = () =>
    draftSaveAllowed(phaseRef.current) &&
    JSON.stringify(toDraftInput(mailRef.current)) !== savedText.current
  const save = (): Promise<void> => {
    if (!draftSaveAllowed(phaseRef.current)) {
      return Promise.reject(new Error('Die E-Mail wird gerade gesendet'))
    }
    const input = toDraftInput(mailRef.current)
    const run = queue.current.then(async () => {
      draftUid.current = await mailApi.saveDraft(input, draftUid.current, accountId)
      savedText.current = JSON.stringify(input)
    })
    queue.current = run.catch(() => undefined)
    return run
  }

  // F5: the draft is saved WHILE typing, so nothing has to happen on the way out.
  // A beforeunload handler cannot tell a reload from a close and is synchronous
  // while saving is not - the old one closed the window on every reload.
  //
  // Only an edit starts it: saving on mount would create a draft for every mail
  // that is merely opened, and the first render is not a change.
  const edited = useRef(false)
  useEffect(() => {
    if (!edited.current || !isDirty()) return
    const timer = setTimeout(() => {
      // a send may have started since the timer was set (MR-38)
      if (closed.current || !isDirty()) return
      save().catch(() => undefined)
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail])

  // Leaving the editor with changes (another mail, another folder) keeps them as a draft
  useEffect(
    () => () => {
      if (closed.current || !isDirty()) return
      save().then(
        () => {
          toast.success('Als Entwurf gespeichert')
          onStoredRef.current()
        },
        (error) =>
          toast.error('Entwurf konnte nicht gespeichert werden', { description: errorText(error) })
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Closing the window with changes that the autosave has not stored yet: hold the
  // close and save. The renderer must NOT call window.close() from here: beforeunload
  // fires for a reload too, and closing the window on a reload destroyed it (F5, F15).
  // Main decides what happens next - it is the only side that knows whether this is a
  // close or a reload (see will-prevent-unload in src/main/index.ts).
  useEffect(() => {
    let leaving = false
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (closed.current || !isDirty()) return
      e.preventDefault()
      e.returnValue = ''
      if (leaving) return
      leaving = true
      save().then(
        () => {
          closed.current = true
          // The draft is stored; ask main to release the close it was holding. The
          // renderer must not call window.close() here: beforeunload cannot tell a close
          // from a reload, and main is the only side that knows (see will-prevent-unload).
          window.api.closeMailWindow()
        },
        (error) => {
          closed.current = true
          leaving = false
          toast.error('Entwurf konnte nicht gespeichert werden', {
            description:
              `${errorText(error) ?? ''} Erneut schließen verwirft die Änderungen.`.trim()
          })
        }
      )
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (patch: Partial<ComposeState>) => {
    edited.current = true
    setMail((m) => ({ ...m, ...patch }))
  }

  /**
   * F3: the editor holds HTML; composeBody reduces it to the formatting the four
   * commands offer and derives the plain text, which stays the source of truth.
   */
  const onBodyInput = () => {
    const html = body.current?.innerHTML ?? ''
    update(composeBody(html))
  }

  const saveNow = async () => {
    setBusy('save')
    try {
      await save()
      setSavedAt(new Date())
      onStored()
    } catch (error) {
      toast.error('Entwurf konnte nicht gespeichert werden', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  // G12: why sending is blocked right now, so the button can say it instead of the
  // click failing with a toast. null means "sendable".
  const sendBlocked = (() => {
    const all = [...mail.to, ...mail.cc, ...mail.bcc]
    if (all.length === 0) return 'Bitte mindestens einen Empfänger angeben'
    const bad = all.find((a) => !isValidEmail(a.email))
    return bad ? `„${bad.email}“ ist keine gültige Adresse` : null
  })()

  const send = async () => {
    // I2 (MR-04): one send at a time. The gate is taken before the first await, so a second
    // Ctrl+Enter in the same tick finds it closed; the subject dialog is inside it too.
    // An unclear send is locked until the user picks "Prüfen" or "Als neue Mail senden".
    if (phaseRef.current !== 'idle' || !gate.enter()) return
    try {
      await sendGated()
    } finally {
      gate.leave()
    }
  }

  const sendGated = async () => {
    const current = mailRef.current
    // The button is disabled while sendBlocked, but Ctrl+Enter calls send() directly, so this
    // guard is still reachable - it is not redundant with the disabled state.
    if (!current.to.length && !current.cc.length && !current.bcc.length) {
      toast.error('Bitte mindestens einen Empfänger angeben')
      return
    }
    const invalid = [...current.to, ...current.cc, ...current.bcc].find(
      (a) => !isValidEmail(a.email)
    )
    if (invalid) {
      toast.error(`„${invalid.email}“ ist keine gültige Adresse`)
      return
    }
    if (
      !current.subject.trim() &&
      !(await confirmAction({ title: 'Ohne Betreff senden?', confirmLabel: 'Senden' }))
    ) {
      return
    }
    setBusy('send')
    setPhase('sending')
    try {
      await queue.current
      // C1: the PDF this window was opened with is read in main and attached here
      const attachments = [...current.attachments]
      if (presetPdfPath) {
        const base64 = await window.api.readComposePdf(presetPdfPath)
        if (base64) {
          attachments.push({
            filename: presetPdfPath.split(/[\\/]/).pop() ?? 'Anhang.pdf',
            contentType: 'application/pdf',
            base64
          })
        }
      }
      const sent = await mailApi.sendMail(
        { ...toDraftInput(current), attachments, sendKey: sendKey.current },
        draftUid.current,
        accountId
      )
      finishSent(sent.messageId)
    } catch (error) {
      if (isUnclearSend(error)) {
        // I2 (MR-03): the server may have the mail. "fehlgeschlagen" would invite a second
        // send, so the editor locks and says what is known.
        setPhase('unclear')
        toast.warning('Versand unklar', {
          description: 'Die E-Mail ist vielleicht schon unterwegs. Bitte erst prüfen.'
        })
      } else {
        setPhase('idle')
        toast.error('Senden fehlgeschlagen', { description: errorText(error) })
      }
    } finally {
      setBusy(null)
    }
  }

  const finishSent = (messageId: string) => {
    closed.current = true
    toast.success('Gesendet')
    onStored()
    onSent?.(messageId)
    onClose()
  }

  /**
   * I2 (MR-03): "Im Ordner Gesendet prüfen". The core looks for this session's Message-ID
   * in Sent and never sends again; found means sent. Not found is not proof either way,
   * so the editor stays locked.
   */
  const checkUnclear = async () => {
    setBusy('send')
    try {
      const op = findSessionSend(await mailApi.listOps(accountId), sendKey.current)
      const check = unclearCheck(op)
      if (op && check === 'sent') {
        finishSent(op.messageId ?? '')
        return
      }
      if (!op || check !== 'probe') {
        toast.info('Versand weiter unklar', {
          description: 'Bitte im Ordner Gesendet nachsehen.'
        })
        return
      }
      const result = await mailApi.resolveOp(op.id, accountId)
      if (result.outcome === 'done' || result.outcome === 'noop') {
        finishSent(op.messageId ?? '')
      } else {
        toast.warning('Nicht im Ordner Gesendet gefunden', {
          description: 'Die E-Mail kann trotzdem zugestellt worden sein.'
        })
      }
    } catch (error) {
      toast.error('Prüfen fehlgeschlagen', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  /** I2: a deliberate second send is a NEW mail with its own Message-ID */
  const sendAsNew = async () => {
    if (
      !(await confirmAction({
        title: 'Als neue E-Mail senden?',
        description:
          'Wenn die erste E-Mail doch angekommen ist, erhalten die Empfänger sie zweimal.',
        confirmLabel: 'Senden'
      }))
    ) {
      return
    }
    sendKey.current = crypto.randomUUID()
    setPhase('idle')
    await send()
  }

  const discard = async () => {
    const stored = draftUid.current !== null
    if (
      (isDirty() || stored) &&
      !(await confirmAction({
        title: 'Entwurf verwerfen?',
        description: stored ? 'Der gespeicherte Entwurf kommt in den Papierkorb.' : undefined,
        confirmLabel: 'Verwerfen',
        destructive: true
      }))
    ) {
      return
    }
    closed.current = true
    setBusy('discard')
    try {
      await queue.current
    } catch (error) {
      toast.error('Entwurf konnte nicht gelöscht werden', { description: errorText(error) })
    }
    // G4: the editor closes now, not after the server has answered. Deleting a draft used to
    // await the whole write - connect, LOGIN, SELECT, UID MOVE, LOGOUT - so the click looked
    // dead for seconds while an inbox delete (same op underneath) felt instant. The discard runs
    // behind the close; a failure is reported as a toast, and the draft stays in Drafts where the
    // user can delete it again.
    if (draftUid.current !== null) {
      const uid = draftUid.current
      void mailApi
        .discardDraft(uid, accountId)
        .then(() => onStored())
        .catch((error) =>
          toast.error('Entwurf konnte nicht gelöscht werden', { description: errorText(error) })
        )
    }
    onClose()
  }

  const addFiles = async (files: FileList | null) => {
    // I2: the mail is locked while it is sent and after an unclear send
    if (!files?.length || phaseRef.current !== 'idle') return
    // B7: checked against the file sizes before anything is read into memory
    if (!attachmentsFit(mailRef.current.attachments, [...files])) {
      toast.error('Anhänge zu groß', {
        description: `Zusammen höchstens ${formatSize(MAX_ATTACHMENT_BYTES)}.`
      })
      return
    }
    try {
      const added = await Promise.all(
        [...files].map(async (file) => ({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          base64: await readBase64(file)
        }))
      )
      // I10 Low: an attachment added here is an edit like any other, or the autosave never runs
      // and the attachment is lost when the window closes
      edited.current = true
      setMail((m) => ({ ...m, attachments: [...m.attachments, ...added] }))
    } catch (error) {
      toast.error('Datei konnte nicht angehängt werden', { description: errorText(error) })
    }
  }

  /**
   * F4: Ctrl+V. A copied or screenshotted file becomes an attachment; only plain
   * text falls through to the normal paste, so a pasted image never becomes a
   * data: URI in the body.
   */
  const onPaste = (event: React.ClipboardEvent) => {
    if (phaseRef.current !== 'idle') {
      event.preventDefault()
      return
    }
    const items = event.clipboardData?.items ?? []
    const types = [...items].map((item) => item.type)
    const content = pasteContent(types)
    if (content.kind === 'text') return
    const files = [...items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    // The default paste would put the image into the body as well
    event.preventDefault()
    const list = files.reduce((acc, file) => {
      acc.items.add(file)
      return acc
    }, new DataTransfer()).files
    void addFiles(list)
  }

  return (
    <form
      onPaste={onPaste}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="E-Mail verfassen"
      // I2 (MR-04): no implicit submit. Enter in Betreff or a recipient field used to send a
      // half-written mail; the editor sends only via the button and Ctrl+Enter.
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          // a held-down key repeats; only the first press sends
          if (!e.repeat) void send()
        }
      }}
    >
      <div className="flex items-center gap-1 border-b px-4 py-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void send()}
          disabled={busy !== null || sendBlocked !== null || locked}
          title={sendBlocked ?? 'Senden (Strg+Enter)'}
          // The accessible name stays the ACTION ("Senden"). Putting the reason in the aria-label made the
          // button answer to "An" and collided with the recipient field of the same name; the reason is a
          // tooltip, and aria-disabled is what tells assistive tech the control is unavailable.
          aria-label="Senden"
        >
          {busy === 'send' ? <Spinner className="size-4" /> : <Send />}
          Senden
        </Button>
        {/* A disabled button cannot be hovered for its title, and a tooltip is not read by a screen
            reader on a disabled control - so the reason is written out where it applies */}
        {sendBlocked && !busy && !locked ? (
          <span className="text-xs text-muted-foreground" data-testid="send-blocked">
            {sendBlocked}
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null || locked}
          onClick={() => void saveNow()}
        >
          {busy === 'save' && <Spinner className="size-4" />}
          Entwurf speichern
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null || locked}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip />
          Anhängen
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {savedAt && (
          <span className="ml-2 text-xs text-muted-foreground">
            Gespeichert{' '}
            {savedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          disabled={busy !== null || locked}
          onClick={() => void discard()}
          title="Verwerfen"
        >
          <Trash2 />
        </Button>
      </div>

      {phase === 'unclear' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="send-unclear"
        >
          <span className="mr-auto">
            Versand unklar: Die E-Mail ist vielleicht schon beim Server angekommen. Bitte prüfen,
            bevor sie noch einmal gesendet wird.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void checkUnclear()}
          >
            {busy === 'send' && <Spinner className="size-4" />}
            Im Ordner Gesendet prüfen
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void sendAsNew()}
          >
            Als neue Mail senden
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              closed.current = true
              onClose()
            }}
          >
            Schließen
          </Button>
        </div>
      )}

      {/* I2: while sending, and after an unclear send, the mail cannot be changed - an edit
          would never reach the mail that went out, and a draft of it would be an orphan */}
      <fieldset disabled={locked} className="contents">
        <RecipientField
          label="An"
          accountId={accountId}
          value={mail.to}
          onChange={(to) => update({ to })}
          autoFocus={mail.to.length === 0}
        />
        {showCopies ? (
          <>
            <RecipientField
              label="Cc"
              accountId={accountId}
              value={mail.cc}
              onChange={(cc) => update({ cc })}
            />
            <RecipientField
              label="Bcc"
              accountId={accountId}
              value={mail.bcc}
              onChange={(bcc) => update({ bcc })}
            />
          </>
        ) : (
          <button
            type="button"
            className="self-start px-4 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowCopies(true)}
          >
            Cc/Bcc
          </button>
        )}
        <div className="flex items-center gap-2 border-b px-4 py-1.5 text-sm">
          <span className="w-12 shrink-0 text-muted-foreground">Betreff</span>
          <Input
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            value={mail.subject}
            onChange={(e) => update({ subject: e.target.value })}
            aria-label="Betreff"
            autoFocus={mail.to.length > 0 && !mail.subject}
          />
        </div>

        {(mail.attachments.length > 0 || mail.forwardedNames.length > 0) && (
          <ul className="flex flex-wrap gap-1 border-b px-4 py-2 text-sm" aria-label="Anhänge">
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
                  onClick={() =>
                    update({ attachments: mail.attachments.filter((_, j) => j !== i) })
                  }
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

        {/* F3: lightweight formatting. The body is HTML, but the plain text stays
          the source of truth: composeBody derives it on every edit, so search and
          snippets keep reading the text. */}
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
        </div>
      </fieldset>
      <div
        className="mail-editor min-h-0 flex-1 overflow-auto px-4 py-3 text-sm outline-none"
        contentEditable={!locked}
        aria-readonly={locked}
        role="textbox"
        aria-label="Text"
        aria-multiline="true"
        ref={body}
        onInput={onBodyInput}
        // The editor shows what the mail will look like, not the tags
        suppressContentEditableWarning
      />
    </form>
  )
}
