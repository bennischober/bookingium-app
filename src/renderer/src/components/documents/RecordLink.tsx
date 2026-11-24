import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { DocumentLinkDto } from '../../../../main/api/schemas/document_link.schema'

/** A link to a record's detail page (on its Dokumente tab), whatever kind it is */
export function RecordLink({
  record,
  className,
  title,
  children
}: {
  record: Pick<DocumentLinkDto, 'kind' | 'id'>
  className?: string
  title?: string
  children: ReactNode
}) {
  const props = { className, title, search: { tab: 'documents' } as never }
  const id = String(record.id)
  switch (record.kind) {
    case 'release':
      return (
        <Link to="/releases/$releaseId" params={{ releaseId: id }} {...props}>
          {children}
        </Link>
      )
    case 'event':
      return (
        <Link to="/events/$eventId" params={{ eventId: id }} {...props}>
          {children}
        </Link>
      )
    case 'band':
      return (
        <Link to="/band/$bandId" params={{ bandId: id }} {...props}>
          {children}
        </Link>
      )
    case 'company':
      return (
        <Link to="/companies/$companyId" params={{ companyId: id }} {...props}>
          {children}
        </Link>
      )
    case 'venue':
      return (
        <Link to="/venues/$venueId" params={{ venueId: id }} {...props}>
          {children}
        </Link>
      )
    case 'person':
      return (
        <Link to="/persons/$personId" params={{ personId: id }} {...props}>
          {children}
        </Link>
      )
  }
}
