import { Input } from '@/components/ui/input'
import type { ComposeState } from './composeDraft'
import { RecipientField } from './RecipientField'
import { t } from '../../../../main/i18n/translate'

/** An, Cc/Bcc and Betreff */
export function ComposeHeaderFields({
  accountId,
  mail,
  update,
  showCopies,
  setShowCopies
}: {
  accountId: string
  mail: ComposeState
  update: (patch: Partial<ComposeState>) => void
  /** Cc and Bcc stay folded away until asked for or already filled */
  showCopies: boolean
  setShowCopies: (show: boolean) => void
}) {
  return (
    <>
      <RecipientField
        label={t('An')}
        accountId={accountId}
        value={mail.to}
        onChange={(to) => update({ to })}
        autoFocus={mail.to.length === 0}
      />
      {showCopies ? (
        <>
          <RecipientField
            label={t('Cc')}
            accountId={accountId}
            value={mail.cc}
            onChange={(cc) => update({ cc })}
          />
          <RecipientField
            label={t('Bcc')}
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
          {t('Cc/Bcc')}
        </button>
      )}
      <div className="flex items-center gap-2 border-b px-4 py-1.5 text-sm">
        <span className="w-12 shrink-0 text-muted-foreground">{t('Betreff')}</span>
        <Input
          className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
          value={mail.subject}
          onChange={(e) => update({ subject: e.target.value })}
          aria-label={t('Betreff')}
          autoFocus={mail.to.length > 0 && !mail.subject}
        />
      </div>
    </>
  )
}
