import type { ColumnDef } from '@tanstack/react-table'
import { Ban, UserMinus } from 'lucide-react'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import {
  RECIPIENT_TYPE_LABELS,
  type ContactListRecipientDto
} from '../../../../main/api/schemas/contactList.schema'
import { t, uiLocale } from '../../../../main/i18n/translate'

/**
 * The recipient table's columns. `onRemoveMember` is given for a member list
 * (#154) and adds "Aus Verteiler entfernen" to each row.
 */
export function contactListColumns({
  onRemoveMember,
  onNoAdvertising
}: {
  onRemoveMember?: (row: ContactListRecipientDto) => void
  onNoAdvertising: (email: string) => void
}): ColumnDef<ContactListRecipientDto>[] {
  return [
    {
      accessorKey: 'name',
      header: t('Name'),
      cell: ({ row }) => <span className="font-medium">{row.original.name || '-'}</span>
    },
    { accessorKey: 'email', header: 'E-Mail' },
    {
      id: 'types',
      header: t('Art'),
      cell: ({ row }) => row.original.types.map((type) => RECIPIENT_TYPE_LABELS[type]).join(', ')
    },
    {
      id: 'sources',
      header: t('Clubs, Festivals, Medien'),
      cell: ({ row }) => {
        const names = row.original.sources.map((source) =>
          source.role ? `${source.name} (${source.role})` : source.name
        )
        const text = names.join(', ')
        return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}...` : text}</span>
      }
    },
    {
      id: 'place',
      header: t('Ort'),
      cell: ({ row }) => [row.original.city, row.original.country].filter(Boolean).join(', ') || '-'
    },
    {
      accessorKey: 'capacity',
      header: t('Kapazität'),
      cell: ({ row }) =>
        row.original.capacity ? row.original.capacity.toLocaleString(uiLocale()) : '-'
    },
    {
      id: 'actions',
      header: t('Aktionen'),
      cell: ({ row }) => (
        <RowActions>
          {onRemoveMember && (
            <RowActionButton
              icon={UserMinus}
              label={t('Aus Verteiler entfernen')}
              onClick={() => onRemoveMember(row.original)}
            />
          )}
          <RowActionButton
            icon={Ban}
            label={t('Keine Werbung')}
            destructive
            onClick={() => onNoAdvertising(row.original.email)}
          />
        </RowActions>
      )
    }
  ]
}
