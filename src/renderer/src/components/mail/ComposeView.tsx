import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { useFileDrop } from '@/hooks/useFileDrop'
import { DropOverlay } from '@/components/ui/drop-overlay'
import { mailApi } from '@/lib/mailApi'
import { trpcVanilla } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { followUpForSend, type FollowUpChoice } from './composeFollowUp'
import type { FollowUpRecord } from '../../../../main/api/schemas/followUp.schema'
import { type ComposeState, draftDirtyKey, isValidEmail, toDraftInput } from './composeDraft'
import { formatSize } from './format'
import { attachmentsFit, MAX_ATTACHMENT_BYTES, pasteContent } from './composeDraft'
import { composeBody, toEditorHtml } from './composeBody'
import { InsertTemplateDialog } from './InsertTemplateDialog'
import {
  type SendPhase,
  createSendGate,
  draftSaveAllowed,
  findSessionSend,
  isUnclearSend,
  unclearCheck
} from './composeSend'
import { ComposeAttachmentList } from './ComposeAttachmentList'
import { ComposeFormatBar } from './ComposeFormatBar'
import { ComposeHeaderFields } from './ComposeHeaderFields'
import { type ComposeBusy, ComposeToolbar } from './ComposeToolbar'
import { ComposeUnclearBanner } from './ComposeUnclearBanner'
import { t } from '../../../../main/i18n/translate'

const errorText = (error: unknown) => (error instanceof Error ? error.message : undefined)

/**
 * F5: how long typing pauses before the draft is stored. Short enough that a
 * reload or a close loses at most the last keystrokes, long enough that a
 * sentence does not save per character.
 */
const AUTOSAVE_MS = 1500

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error(t('Datei konnte nicht gelesen werden')))
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
  invoice,
  record
}: {
  accountId: string
  initial: ComposeState
  /** The editor is done (sent or discarded) */
  onClose: () => void
  /** Drafts or Sent changed */
  onStored: () => void
  /**
   * C1/I7: the window is an invoice mail. It sends through main with this token; main
   * attaches the invoice PDF, which the window knows only by name.
   */
  invoice?: { token: string; attachmentName: string }
  /** #121: the record a follow-up of this mail is filed on (the invoice or contract mailed) */
  record?: FollowUpRecord | null
}) {
  const [mail, setMail] = useState(initial)
  const [showCopies, setShowCopies] = useState(initial.cc.length > 0 || initial.bcc.length > 0)
  const [busy, setBusy] = useState<ComposeBusy>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  // #121: "Wiedervorlage ohne Antwort" - a follow-up the send leaves, closed by a reply
  const [followUpChoice, setFollowUpChoice] = useState<FollowUpChoice>('none')
  const body = useRef<HTMLDivElement>(null)
  // #123: the template dialog, and where the caret was when it opened (the dialog takes the focus)
  const [templateOpen, setTemplateOpen] = useState(false)
  const templateCaret = useRef<Range | null>(null)
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
  const savedKey = useRef(draftDirtyKey(initial))
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

  // Draft saves only while idle (MR-38): see draftSaveAllowed. The comparison uses
  // attachment fingerprints, not their base64 (MR-38, see draftDirtyKey)
  const isDirty = () =>
    draftSaveAllowed(phaseRef.current) && draftDirtyKey(mailRef.current) !== savedKey.current
  const save = (): Promise<void> => {
    if (!draftSaveAllowed(phaseRef.current)) {
      return Promise.reject(new Error(t('Die E-Mail wird gerade gesendet')))
    }
    // I17 (write path L7): the session key ties the saves of this editor together in the journal
    const input = { ...toDraftInput(mailRef.current), sendKey: sendKey.current }
    const key = draftDirtyKey(mailRef.current)
    const run = queue.current.then(async () => {
      draftUid.current = await mailApi.saveDraft(input, draftUid.current, accountId)
      savedKey.current = key
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
          toast.success(t('Als Entwurf gespeichert'))
          onStoredRef.current()
        },
        (error) =>
          toast.error(t('Entwurf konnte nicht gespeichert werden'), {
            description: errorText(error)
          })
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
          toast.error(t('Entwurf konnte nicht gespeichert werden'), {
            description: t('{{value}} Erneut schließen verwirft die Änderungen.', {
              value: errorText(error) ?? ''
            }).trim()
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

  const openTemplates = () => {
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    templateCaret.current =
      range && body.current?.contains(range.commonAncestorContainer) ? range.cloneRange() : null
    setTemplateOpen(true)
  }

  /**
   * #123: the template's text goes where the caret was, else at the top (above a quote and the
   * signature); its subject only into an empty subject, a reply's "Re:" stays
   */
  const insertTemplate = ({ subject, body: text }: { subject: string; body: string }) => {
    const editor = body.current
    if (!editor) return
    editor.focus()
    let range = templateCaret.current
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange()
      range.setStart(editor.firstElementChild ?? editor, 0)
      range.collapse(true)
    }
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // insertHTML keeps the browser's undo; the text is escaped into paragraphs
    document.execCommand('insertHTML', false, toEditorHtml(text))
    const filled = composeBody(editor.innerHTML)
    update(mail.subject.trim() ? filled : { ...filled, subject })
  }

  const saveNow = async () => {
    setBusy('save')
    try {
      await save()
      setSavedAt(new Date())
      onStored()
    } catch (error) {
      toast.error(t('Entwurf konnte nicht gespeichert werden'), { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  // G12: why sending is blocked right now, so the button can say it instead of the
  // click failing with a toast. null means "sendable".
  const sendBlocked = (() => {
    const all = [...mail.to, ...mail.cc, ...mail.bcc]
    if (all.length === 0) return t('Bitte mindestens einen Empfänger angeben')
    const bad = all.find((a) => !isValidEmail(a.email))
    return bad ? t('„{{email}}“ ist keine gültige Adresse', { email: bad.email }) : null
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
      toast.error(t('Bitte mindestens einen Empfänger angeben'))
      return
    }
    const invalid = [...current.to, ...current.cc, ...current.bcc].find(
      (a) => !isValidEmail(a.email)
    )
    if (invalid) {
      toast.error(t('„{{email}}“ ist keine gültige Adresse', { email: invalid.email }))
      return
    }
    if (
      !current.subject.trim() &&
      !(await confirmAction({ title: t('Ohne Betreff senden?'), confirmLabel: t('Senden') }))
    ) {
      return
    }
    setBusy('send')
    setPhase('sending')
    try {
      await queue.current
      const mail = { ...toDraftInput(current), sendKey: sendKey.current }
      // I7: an invoice mail goes through main, which attaches the PDF and marks the invoice
      const sent = invoice
        ? await trpcVanilla.mail.sendInvoice.mutate({
            token: invoice.token,
            accountId,
            draftUid: draftUid.current,
            mail
          })
        : await mailApi.sendMail(mail, draftUid.current, accountId)
      await finishSent(sent.messageId)
    } catch (error) {
      if (isUnclearSend(error)) {
        // I2 (MR-03): the server may have the mail. "fehlgeschlagen" would invite a second
        // send, so the editor locks and says what is known.
        setPhase('unclear')
        toast.warning(t('Versand unklar'), {
          description: t('Die E-Mail ist vielleicht schon unterwegs. Bitte erst prüfen.')
        })
      } else {
        setPhase('idle')
        toast.error(t('Senden fehlgeschlagen'), { description: errorText(error) })
      }
    } finally {
      setBusy(null)
    }
  }

  /**
   * The mail is out. #121: a chosen follow-up is filed before the window closes, with
   * the Message-ID the reply will name; failing to file it never undoes the send.
   */
  const finishSent = async (messageId: string | null | undefined) => {
    closed.current = true
    const followUp = followUpForSend({
      choice: followUpChoice,
      subject: mailRef.current.subject,
      accountId,
      messageId: messageId ?? '',
      record
    })
    let filed = false
    if (followUp) {
      try {
        await trpcVanilla.followUp.create.mutate(followUp)
        filed = true
      } catch (error) {
        toast.error(t('Wiedervorlage nicht angelegt'), { description: errorText(error) })
      }
    }
    toast.success(t('Gesendet'), filed ? { description: t('Wiedervorlage angelegt') } : undefined)
    onStored()
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
        await finishSent(op.messageId)
        return
      }
      if (!op || check !== 'probe') {
        toast.info(t('Versand weiter unklar'), {
          description: t('Bitte im Ordner Gesendet nachsehen.')
        })
        return
      }
      const result = await mailApi.resolveOp(op.id, accountId)
      if (result.outcome === 'done' || result.outcome === 'noop') {
        await finishSent(op.messageId)
      } else {
        toast.warning(t('Nicht im Ordner Gesendet gefunden'), {
          description: t('Die E-Mail kann trotzdem zugestellt worden sein.')
        })
      }
    } catch (error) {
      toast.error(t('Prüfen fehlgeschlagen'), { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  /** I2: a deliberate second send is a NEW mail with its own Message-ID */
  const sendAsNew = async () => {
    if (
      !(await confirmAction({
        title: t('Als neue E-Mail senden?'),
        description: t(
          'Wenn die erste E-Mail doch angekommen ist, erhalten die Empfänger sie zweimal.'
        ),
        confirmLabel: t('Senden')
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
        title: t('Entwurf verwerfen?'),
        description: stored ? t('Der gespeicherte Entwurf kommt in den Papierkorb.') : undefined,
        confirmLabel: t('Verwerfen'),
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
      toast.error(t('Entwurf konnte nicht gelöscht werden'), { description: errorText(error) })
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
          toast.error(t('Entwurf konnte nicht gelöscht werden'), { description: errorText(error) })
        )
    }
    onClose()
  }

  const addFiles = async (files: FileList | null) => {
    // I2: the mail is locked while it is sent and after an unclear send
    if (!files?.length || phaseRef.current !== 'idle') return
    // B7: checked against the file sizes before anything is read into memory
    if (!attachmentsFit(mailRef.current.attachments, [...files])) {
      toast.error(t('Anhänge zu groß'), {
        description: t('Zusammen höchstens {{formatSize}}.', {
          formatSize: formatSize(MAX_ATTACHMENT_BYTES)
        })
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
      toast.error(t('Datei konnte nicht angehängt werden'), { description: errorText(error) })
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

  // Files dragged from the file manager become attachments wherever they are dropped. The
  // capture phase runs before the editor, which would otherwise put an image into the body.
  const attachDrop = useFileDrop({
    disabled: locked,
    onFiles: (_paths, files) =>
      addFiles(
        files.reduce((acc, file) => {
          acc.items.add(file)
          return acc
        }, new DataTransfer()).files
      )
  })

  return (
    <form
      onPaste={onPaste}
      onDragEnterCapture={attachDrop.dropProps.onDragEnter}
      onDragOverCapture={attachDrop.dropProps.onDragOver}
      onDragLeaveCapture={attachDrop.dropProps.onDragLeave}
      onDropCapture={attachDrop.dropProps.onDrop}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={t('E-Mail verfassen')}
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
      <DropOverlay
        show={attachDrop.dragging}
        title={t('Als Anhang ablegen')}
        hint={t('Die Dateien werden an diese E-Mail angehängt.')}
      />
      <ComposeToolbar
        busy={busy}
        sendBlocked={sendBlocked}
        locked={locked}
        savedAt={savedAt}
        followUpChoice={followUpChoice}
        setFollowUpChoice={setFollowUpChoice}
        send={send}
        saveNow={saveNow}
        addFiles={addFiles}
        discard={discard}
      />

      {phase === 'unclear' && (
        <ComposeUnclearBanner
          busy={busy}
          checkUnclear={checkUnclear}
          sendAsNew={sendAsNew}
          close={() => {
            closed.current = true
            onClose()
          }}
        />
      )}

      {/* I2: while sending, and after an unclear send, the mail cannot be changed - an edit
          would never reach the mail that went out, and a draft of it would be an orphan */}
      <fieldset disabled={locked} className="contents">
        <ComposeHeaderFields
          accountId={accountId}
          mail={mail}
          update={update}
          showCopies={showCopies}
          setShowCopies={setShowCopies}
        />

        <ComposeAttachmentList mail={mail} invoice={invoice} update={update} />

        <ComposeFormatBar
          body={body}
          onBodyInput={onBodyInput}
          locked={locked}
          openTemplates={openTemplates}
        />
      </fieldset>
      <div
        className="mail-editor min-h-0 flex-1 overflow-auto px-4 py-3 text-sm outline-none"
        contentEditable={!locked}
        aria-readonly={locked}
        role="textbox"
        aria-label={t('Text')}
        aria-multiline="true"
        ref={body}
        onInput={onBodyInput}
        // The editor shows what the mail will look like, not the tags
        suppressContentEditableWarning
      />
      <InsertTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        accountId={accountId}
        inReplyTo={mail.inReplyTo}
        recipient={mail.to[0]?.name ?? ''}
        onInsert={insertTemplate}
      />
    </form>
  )
}
