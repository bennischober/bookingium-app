import { useRef } from 'react'
import { Paperclip, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { FOLLOW_UP_CHOICES, type FollowUpChoice } from './composeFollowUp'
import { t, uiLocale } from '../../../../main/i18n/translate'

/** What the editor is waiting for; every button is off while it waits */
export type ComposeBusy = 'send' | 'save' | 'discard' | null

/** Senden, Entwurf speichern, Anhängen, Wiedervorlage and Verwerfen */
export function ComposeToolbar({
  busy,
  sendBlocked,
  locked,
  savedAt,
  followUpChoice,
  setFollowUpChoice,
  send,
  saveNow,
  addFiles,
  discard
}: {
  busy: ComposeBusy
  /** Why the mail cannot be sent yet, or null */
  sendBlocked: string | null
  /** I2: sending, or after an unclear send */
  locked: boolean
  savedAt: Date | null
  followUpChoice: FollowUpChoice
  setFollowUpChoice: (choice: FollowUpChoice) => void
  send: () => Promise<void>
  saveNow: () => Promise<void>
  addFiles: (files: FileList | null) => Promise<void>
  discard: () => Promise<void>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-1 border-b px-4 py-2">
      <Button
        type="button"
        size="sm"
        onClick={() => void send()}
        disabled={busy !== null || sendBlocked !== null || locked}
        title={sendBlocked ?? t('Senden (Strg+Enter)')}
        // The accessible name stays the ACTION ("Senden"). Putting the reason in the aria-label made the
        // button answer to "An" and collided with the recipient field of the same name; the reason is a
        // tooltip, and aria-disabled is what tells assistive tech the control is unavailable.
        aria-label={t('Senden')}
      >
        {busy === 'send' ? <Spinner className="size-4" /> : <Send />}
        {t('Senden')}
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
        {t('Entwurf speichern')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy !== null || locked}
        onClick={() => fileInput.current?.click()}
      >
        <Paperclip />
        {t('Anhängen')}
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
      <Select
        value={followUpChoice}
        onValueChange={(value) => setFollowUpChoice(value as FollowUpChoice)}
        disabled={busy !== null || locked}
      >
        <SelectTrigger
          className="ml-1 h-8 w-auto gap-1 text-xs"
          aria-label={t('Wiedervorlage ohne Antwort')}
          title={t('Wiedervorlage ohne Antwort: erledigt sich, wenn eine Antwort kommt')}
        >
          <span className="text-muted-foreground">{t('Wiedervorlage:')}</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FOLLOW_UP_CHOICES.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {savedAt && (
        <span className="ml-2 text-xs text-muted-foreground">
          {t('Gespeichert')}{' '}
          {savedAt.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        disabled={busy !== null || locked}
        onClick={() => void discard()}
        title={t('Verwerfen')}
      >
        <Trash2 />
      </Button>
    </div>
  )
}
