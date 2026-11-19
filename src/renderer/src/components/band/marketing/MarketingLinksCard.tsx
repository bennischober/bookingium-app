import { Link } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { InfoCard } from '@/components/detail/DetailParts'
import {
  MARKETING_CATEGORY_LABELS,
  MARKETING_STATUS_LABELS,
  type MarketingLinkDto
} from '../../../../../main/api/schemas/marketing.schema'

function Links({ links }: { links: MarketingLinkDto[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {links.map((link) => (
        <li key={link.id} className="flex flex-wrap items-baseline gap-x-2">
          <Link
            to="/band/$bandId"
            params={{ bandId: String(link.bandId) }}
            search={{ tab: 'marketing' }}
            className="font-medium hover:underline"
          >
            {link.bandName}
          </Link>
          <span className="text-muted-foreground">
            {MARKETING_CATEGORY_LABELS[link.category]} · Priorität {link.priority} ·{' '}
            {MARKETING_STATUS_LABELS[link.status]}
          </span>
          {link.statusNote && (
            <span className="basis-full text-muted-foreground">{link.statusNote}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** On a company page: the bands whose Marketing-Atlas names this company */
export function CompanyMarketingCard({ companyId }: { companyId: number }) {
  const links = trpcReact.marketing.forCompany.useQuery(companyId)
  if (!links.data?.length) return null
  return (
    <InfoCard label="Marketing-Atlas">
      <Links links={links.data} />
    </InfoCard>
  )
}

/** On a club/festival page: the bands whose Marketing-Atlas names it */
export function VenueMarketingCard({ venueId }: { venueId: number }) {
  const links = trpcReact.marketing.forVenue.useQuery(venueId)
  if (!links.data?.length) return null
  return (
    <InfoCard label="Marketing-Atlas">
      <Links links={links.data} />
    </InfoCard>
  )
}
