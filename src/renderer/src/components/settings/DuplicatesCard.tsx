import { useState } from 'react'
import { Copy } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MergeDialog } from '@/components/detail/MergeDialog'
import type { MergeKind } from '../../../../main/api/schemas/merge.schema'
import { t } from '../../../../main/i18n/translate'

const KIND_LABELS: Record<Exclude<MergeKind, 'band'>, string> = {
  company: t('Firmen'),
  venue: t('Clubs / Festivals'),
  person: t('Personen')
}

/**
 * "Doppelte Einträge" (Einstellungen › Daten): records of one kind with the same name, e.g. a
 * promoter imported as "Beispiel Konzerte" and "Beispiel Konzerte GmbH". Each group opens the
 * usual merge dialog on its oldest record, with the others suggested.
 */
export function DuplicatesCard() {
  const [kind, setKind] = useState<Exclude<MergeKind, 'band'>>('company')
  const [merging, setMerging] = useState<{ id: number; name: string } | null>(null)
  const groups = trpcReact.merge.duplicates.useQuery({ kind })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Doppelte Einträge')}</CardTitle>
        <CardDescription>
          {t(
            'Einträge mit gleichem Namen (bei Firmen ohne Rechtsform, also „Beispiel GmbH“ = „Beispiel“). Zusammenführen übernimmt Events, Rechnungen, Kontakte und Dokumente in einen Eintrag.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={kind}
          onValueChange={(value) => value && setKind(value as Exclude<MergeKind, 'band'>)}
        >
          {(Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>).map((key) => (
            <ToggleGroupItem key={key} value={key}>
              {KIND_LABELS[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {groups.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('Wird gesucht…')}</p>
        ) : (groups.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Keine doppelten Namen gefunden.')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {groups.data!.length === 1
                ? t('1 Name kommt mehrfach vor.')
                : t('{{count}} Namen kommen mehrfach vor.', { count: groups.data!.length })}
            </p>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {groups.data!.map((group) => (
                <li key={group.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {group.items.map((item) => item.name).join(' · ')}
                  </span>
                  <span className="text-xs text-muted-foreground">{group.items.length}×</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => setMerging(group.items[0])}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t('Zusammenführen…')}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {merging && (
        <MergeDialog
          kind={kind}
          id={merging.id}
          name={merging.name}
          onClose={() => {
            setMerging(null)
            void groups.refetch()
          }}
        />
      )}
    </Card>
  )
}
