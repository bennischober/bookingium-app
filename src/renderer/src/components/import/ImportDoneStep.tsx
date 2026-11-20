import { CheckCircle2 } from 'lucide-react'
import type { ImportResult, ImportTarget } from '../../../../main/api/schemas/import.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'
import type { CompanyKind } from '../../../../main/api/schemas/company.schema'
import { SINGULAR, summaryEntities } from './importLabels'
import { t } from '../../../../main/i18n/translate'

interface ImportDoneStepProps {
  target: ImportTarget
  kind: VenueKind
  companyKind: CompanyKind
  result: ImportResult
}

/** Step 4: what the import created and completed */
export function ImportDoneStep({ target, kind, companyKind, result }: ImportDoneStepProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <CheckCircle2 className="h-12 w-12 text-primary" />
      <div className="space-y-1 text-sm">
        {summaryEntities(target, kind, companyKind).map(([entity, label]) => (
          <p key={entity}>
            <strong>{result[entity].created}</strong>{' '}
            {result[entity].created === 1 ? (SINGULAR[label] ?? label) : label} angelegt,{' '}
            <strong>{result[entity].updated}</strong> {t('ergänzt')}
          </p>
        ))}
        {result.contactList && (
          <p>
            <strong>{result.contactList.added}</strong>{' '}
            {result.contactList.added === 1 ? t('Kontakt') : t('Kontakte')}{' '}
            {t('in den Verteiler „')}
            {result.contactList.name}
            {t('“ aufgenommen')}
          </p>
        )}
      </div>
    </div>
  )
}
