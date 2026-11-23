import { useState } from 'react'
import { Building2, CalendarRange, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ROUTES } from '@/lib/routing'
import { TourImportDialog } from '@/components/tour-import/TourImportDialog'
import { AgencyImportDialog } from '@/components/agency/AgencyImportDialog'
import { ImportDialog } from '@/components/import/ImportDialog'
import { useStaffAccess } from '@/hooks/useStaffAccess'
import { TERMS } from '../../../../main/api/terms'
import type { ImportTarget } from '../../../../main/api/schemas/import.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'
import { t } from '../../../../main/i18n/translate'

type Open =
  | { kind: 'tour' }
  | { kind: 'agency' }
  | { kind: 'list'; target: ImportTarget; venueKind?: VenueKind }
  | null

// Lists an Excel or CSV file can fill, in the order of the "+ Neu" menu
const LIST_ITEMS: Array<{
  label: string
  icon: (typeof ROUTES)['bands']['icon']
  target: ImportTarget
  venueKind?: VenueKind
}> = [
  { label: TERMS.band.plural, icon: ROUTES.bands.icon, target: 'bands' },
  { label: TERMS.person.plural, icon: ROUTES.persons.icon, target: 'persons' },
  { label: TERMS.company.plural, icon: ROUTES.companies.icon, target: 'companies' },
  { label: TERMS.club.plural, icon: ROUTES.clubs.icon, target: 'venues', venueKind: 'venue' },
  {
    label: TERMS.festival.plural,
    icon: ROUTES.festivals.icon,
    target: 'venues',
    venueKind: 'festival'
  }
]

const itemClass =
  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none'

/**
 * Top bar "Import", next to "+ Neu": every import from anywhere - tour dates first, then
 * agency bookings and the contact lists.
 */
export function ImportMenu() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  // #262: the lists (CSV import) are closed in staff access; tour dates and agency bookings stay
  const { locked } = useStaffAccess()
  const choose = (next: Open): void => {
    setMenuOpen(false)
    setOpen(next)
  }
  const closeOn = (next: boolean): void => {
    if (!next) setOpen(null)
  }

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            aria-label={t('Import')}
            title={t('Importieren: Tourdaten, Agenturbuchungen, Listen')}
          >
            <Upload className="h-4 w-4" />
            <span className="hidden md:inline">{t('Import')}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <div role="menu" aria-label={t('Importieren')} className="flex flex-col">
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => choose({ kind: 'tour' })}
            >
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              {t('Tourdaten')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => choose({ kind: 'agency' })}
            >
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {t('Agenturbuchungen')}
            </button>
            {!locked && <div className="my-1 h-px bg-border" aria-hidden />}
            {(locked ? [] : LIST_ITEMS).map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() =>
                  choose({ kind: 'list', target: item.target, venueKind: item.venueKind })
                }
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                {item.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <TourImportDialog open={open?.kind === 'tour'} onOpenChange={closeOn} />
      <AgencyImportDialog open={open?.kind === 'agency'} onOpenChange={closeOn} />
      {open?.kind === 'list' && (
        <ImportDialog
          key={`${open.target}-${open.venueKind ?? ''}`}
          open
          onOpenChange={closeOn}
          target={open.target}
          kind={open.venueKind}
        />
      )}
    </>
  )
}
