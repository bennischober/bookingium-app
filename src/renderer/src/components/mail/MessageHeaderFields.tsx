import { ReplyStateIcons } from './ReplyStateIcons'
import type { MessageDetail } from '../../../../main/mailclient/core/types'
import { formatAddresses, formatFullDate } from './format'
import { t } from '../../../../main/i18n/translate'

type Address = { name: string; email: string }

/** Von, An, Cc and Datum of the open mail */
export function MessageHeaderFields({
  message,
  onWriteTo
}: {
  message: MessageDetail
  /** F2: opens a NEW mail to one header address (writable accounts only) */
  onWriteTo?: (address: Address) => void
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
      <dt className="text-muted-foreground">{t('Von')}</dt>
      <dd className="truncate">
        <HeaderAddress
          address={{ name: message.fromName, email: message.fromEmail }}
          onWriteTo={onWriteTo}
        />
      </dd>
      <dt className="text-muted-foreground">{t('An')}</dt>
      <dd className="truncate" title={formatAddresses(message.to)}>
        <HeaderAddressList addresses={message.to} onWriteTo={onWriteTo} />
      </dd>
      {message.cc.length > 0 && (
        <>
          <dt className="text-muted-foreground">{t('Cc')}</dt>
          <dd className="truncate" title={formatAddresses(message.cc)}>
            <HeaderAddressList addresses={message.cc} onWriteTo={onWriteTo} />
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">{t('Datum')}</dt>
      <dd className="flex flex-wrap items-center gap-x-3">
        {formatFullDate(message.date ?? message.internalDate)}
        <ReplyStateIcons answered={message.isAnswered} forwarded={message.isForwarded} withLabel />
      </dd>
    </dl>
  )
}

/**
 * F2: one address in a mail header. A button when the account may write, so a
 * click starts a NEW mail to that person - not a reply to this one.
 */
function HeaderAddress({
  address,
  onWriteTo
}: {
  address: { name: string; email: string }
  onWriteTo?: (address: { name: string; email: string }) => void
}) {
  const label = formatAddresses([address])
  if (!onWriteTo || !address.email) return <span title={label}>{label}</span>
  return (
    <button
      type="button"
      className="hover:underline"
      title={t('Neue E-Mail an {{label}}', { label })}
      onClick={() => onWriteTo(address)}
    >
      {label}
    </button>
  )
}

/** The same for a list (An, Cc): every address is its own button */
function HeaderAddressList({
  addresses,
  onWriteTo
}: {
  addresses: { name: string; email: string }[]
  onWriteTo?: (address: { name: string; email: string }) => void
}) {
  if (addresses.length === 0) return <span>–</span>
  return (
    <>
      {addresses.map((address, index) => (
        <span key={`${address.email}-${index}`}>
          {index > 0 && ', '}
          <HeaderAddress address={address} onWriteTo={onWriteTo} />
        </span>
      ))}
    </>
  )
}
