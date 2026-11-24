import { useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, FileUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useLabelCopyImport } from '@/components/release/useLabelCopyImport'
import { MarketingActions } from '@/components/band/marketing/MarketingActions'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { confirmDelete } from '@/lib/confirm'
import { formatShortDate } from '@/lib/utils'
import { parseRecordId } from '@/lib/recordId'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/load-states'
import { FormSheet } from '@/components/form-sheet'
import { ReleaseForm } from '@/components/forms/ReleaseForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { FactSheet, TabSection } from '@/components/detail/CompactParts'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { isReleaseTab } from '@/components/release/constants'
import { CreditsDialog, ProductDialog, TrackDialog } from '@/components/release/ReleaseDialogs'
import { releaseTitle, totalDuration, trackTitle } from '@/components/release/releaseText'
import {
  RELEASE_FORMAT_LABELS,
  RELEASE_TYPE_LABELS,
  WORK_ROLE_LABELS,
  type ProductDto,
  type ReleaseDetailDto,
  type ReleaseDto,
  type TrackDto
} from '../../../main/api/schemas/release.schema'
import { formatDuration, isValidGtin, isValidIsrc, shareTotals } from '../../../main/release/codes'
import { t } from '../../../main/i18n/translate'

const date = (value: string | null) => (value ? formatShortDate(value) : null)

/** A code with a hint when it fails its check */
function Code({ value, valid }: { value: string; valid: boolean }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  return (
    <span className="font-mono text-xs">
      {value}
      {!valid && (
        <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-700">
          {t('prüfen')}
        </Badge>
      )}
    </span>
  )
}

function OverviewTab({
  release,
  onEditCredits
}: {
  release: ReleaseDetailDto
  onEditCredits: () => void
}) {
  const total = totalDuration(release.tracks)
  const labelCopy = useLabelCopyImport({ releaseId: release.id })
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          {t(
            'Labelcopy als Excel oder PDF einlesen: leere Felder werden ergänzt, Tracks und Produkte über ISRC und UPC zugeordnet.'
          )}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={labelCopy.reading}
          onClick={labelCopy.start}
        >
          <FileUp className="h-3.5 w-3.5" />
          {labelCopy.reading ? t('Wird gelesen…') : t('Labelcopy einlesen')}
        </Button>
      </div>
      {labelCopy.dialog}
      <FactSheet
        groups={[
          {
            title: t('Release'),
            facts: [
              [t('Artist'), release.artist],
              [
                t('Band'),
                release.bandId !== null && release.bandName && (
                  <Link
                    to="/band/$bandId"
                    params={{ bandId: String(release.bandId) }}
                    className="font-medium hover:underline"
                  >
                    {release.bandName}
                  </Link>
                )
              ],
              [t('Art'), RELEASE_TYPE_LABELS[release.releaseType]],
              [t('VÖ-Datum'), date(release.releaseDate)],
              [t('Erst-VÖ'), date(release.originalReleaseDate)],
              [t('Pre-Order D2C'), date(release.preorderD2cDate)],
              [t('Pre-Order Handel'), date(release.preorderRetailDate)],
              [t('Pre-Order digital'), date(release.preorderDigitalDate)],
              [
                t('Umfang'),
                release.tracks.length > 0 &&
                  [
                    t('{{count}} Tracks', { count: release.tracks.length }),
                    total !== null && formatDuration(total)
                  ]
                    .filter(Boolean)
                    .join(' · ')
              ]
            ]
          },
          {
            title: t('Label und Rechte'),
            facts: [
              [
                t('Label'),
                release.labelCompanyId !== null && release.labelCompanyName ? (
                  <Link
                    to="/companies/$companyId"
                    params={{ companyId: String(release.labelCompanyId) }}
                    className="font-medium hover:underline"
                  >
                    {release.labelShown}
                  </Link>
                ) : (
                  release.labelShown
                )
              ],
              [t('Katalognummer'), release.catalogNumber],
              [t('℗-Zeile'), release.pLine],
              [t('©-Zeile'), release.cLine],
              [t('Genre'), [release.genre, release.subGenre].filter(Boolean).join(' / ')],
              [t('Sprache'), release.metadataLanguage],
              [t('Aufnahmeland'), release.recordingCountry],
              [t('Projektnummer'), release.projectNumber]
            ]
          },
          {
            title: t('Anmerkungen'),
            facts: [
              [
                t('Notiz'),
                release.notes && <span className="whitespace-pre-wrap">{release.notes}</span>
              ]
            ]
          }
        ]}
      />

      <TabSection title={t('Credits')}>
        {release.credits.length === 0 ? (
          <EmptyState>
            {t('Noch keine Credits (Produktion, Mix, Mastering, Artwork …).')}
          </EmptyState>
        ) : (
          <dl className="grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            {release.credits.map((credit) => (
              <div key={credit.id} className="contents">
                <dt className="text-muted-foreground">{credit.role || t('ohne Rolle')}</dt>
                <dd>
                  {credit.name}
                  {credit.instrument && (
                    <span className="text-muted-foreground"> · {credit.instrument}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onEditCredits}>
          <Pencil className="h-3.5 w-3.5" />
          {t('Credits bearbeiten')}
        </Button>
      </TabSection>
    </div>
  )
}

function TracksTab({
  release,
  onEdit
}: {
  release: ReleaseDetailDto
  onEdit: (track: TrackDto | null) => void
}) {
  const utils = trpcReact.useUtils()
  const handlers = {
    onSuccess: () => void utils.release.invalidate(),
    onError: (error: { message: string }) =>
      toast.error(t('Nicht gespeichert'), { description: error.message })
  }
  const move = trpcReact.release.moveTrack.useMutation(handlers)
  const remove = trpcReact.release.deleteTrack.useMutation(handlers)
  const total = totalDuration(release.tracks)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {release.tracks.length > 0 &&
            [
              t('{{count}} Tracks', { count: release.tracks.length }),
              total !== null && t('Gesamtdauer {{value}}', { value: formatDuration(total) })
            ]
              .filter(Boolean)
              .join(' · ')}
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => onEdit(null)}>
          <Plus className="h-3.5 w-3.5" />
          {t('Track hinzufügen')}
        </Button>
      </div>
      {release.tracks.length === 0 ? (
        <EmptyState>{t('Noch keine Tracks.')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" aria-label={t('Tracks')}>
            <thead className="bg-muted text-left">
              <tr>
                <th className="w-10 px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t('Titel')}</th>
                <th className="px-3 py-2 font-medium">{t('Dauer')}</th>
                <th className="px-3 py-2 font-medium">ISRC</th>
                <th className="px-3 py-2 font-medium">{t('Mitwirkende')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Aktionen')}</th>
              </tr>
            </thead>
            <tbody>
              {release.tracks.map((track, index) => (
                <tr key={track.id} className="border-t">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{track.position}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => onEdit(track)}
                    >
                      {trackTitle(track)}
                    </button>
                    {track.explicit && (
                      <Badge variant="outline" className="ml-2">
                        E
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDuration(track.durationSeconds) || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <Code value={track.isrc} valid={isValidIsrc(track.isrc)} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {track.contributors.map((c) => c.name).join(', ') || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <RowActions>
                      <RowActionButton
                        icon={ArrowUp}
                        label={t('Nach oben')}
                        disabled={index === 0 || move.isPending}
                        onClick={() => move.mutate({ id: track.id, direction: 'up' })}
                      />
                      <RowActionButton
                        icon={ArrowDown}
                        label={t('Nach unten')}
                        disabled={index === release.tracks.length - 1 || move.isPending}
                        onClick={() => move.mutate({ id: track.id, direction: 'down' })}
                      />
                      <RowActionButton
                        icon={Pencil}
                        label={t('Bearbeiten')}
                        onClick={() => onEdit(track)}
                      />
                      <RowActionButton
                        icon={Trash2}
                        label={t('Löschen')}
                        destructive
                        onClick={() =>
                          void confirmDelete(
                            t(
                              'Track „{{title}}“ löschen? Er verschwindet auch aus den Tracklisten.',
                              {
                                title: track.title
                              }
                            )
                          ).then((ok) => ok && remove.mutate(track.id))
                        }
                      />
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ProductCard({
  product,
  tracks,
  onEdit
}: {
  product: ProductDto
  tracks: TrackDto[]
  onEdit: () => void
}) {
  const utils = trpcReact.useUtils()
  const remove = trpcReact.release.deleteProduct.useMutation({
    onSuccess: () => void utils.release.invalidate(),
    onError: (error) => toast.error(t('Nicht gelöscht'), { description: error.message })
  })
  const byId = new Map(tracks.map((track) => [track.id, track]))
  const name = [RELEASE_FORMAT_LABELS[product.format], product.title].filter(Boolean).join(' · ')
  const details = [product.packaging, product.color, product.territory].filter(Boolean).join(' · ')
  const showSide = product.tracks.some((pt) => pt.side)
  const showDisc = product.tracks.some((pt) => pt.disc > 1)

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{name}</h3>
          {details && <p className="text-sm text-muted-foreground">{details}</p>}
        </div>
        <RowActions>
          <RowActionButton icon={Pencil} label={t('Bearbeiten')} onClick={onEdit} />
          <RowActionButton
            icon={Trash2}
            label={t('Löschen')}
            destructive
            onClick={() =>
              void confirmDelete(t('Produkt „{{name}}“ löschen?', { name })).then(
                (ok) => ok && remove.mutate(product.id)
              )
            }
          />
        </RowActions>
      </div>
      <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">UPC / EAN</dt>
        <dd>
          <Code value={product.upc} valid={isValidGtin(product.upc)} />
        </dd>
        <dt className="text-muted-foreground">{t('Katalognummer')}</dt>
        <dd>{product.catalogNumber || '-'}</dd>
        {product.releaseDate && (
          <>
            <dt className="text-muted-foreground">{t('VÖ-Datum')}</dt>
            <dd>{formatShortDate(product.releaseDate)}</dd>
          </>
        )}
        {product.discCount !== null && (
          <>
            <dt className="text-muted-foreground">{t('Discs')}</dt>
            <dd>{product.discCount}</dd>
          </>
        )}
        {product.priceCode && (
          <>
            <dt className="text-muted-foreground">{t('Preiscode')}</dt>
            <dd>{product.priceCode}</dd>
          </>
        )}
        {product.boxLot !== null && (
          <>
            <dt className="text-muted-foreground">Box Lot</dt>
            <dd>{product.boxLot}</dd>
          </>
        )}
        {product.notes && (
          <>
            <dt className="text-muted-foreground">{t('Notiz')}</dt>
            <dd className="whitespace-pre-wrap">{product.notes}</dd>
          </>
        )}
      </dl>
      {product.tracks.length > 0 ? (
        <ol className="divide-y rounded-md border text-sm">
          {product.tracks.map((pt) => {
            const track = byId.get(pt.trackId)
            if (!track) return null
            return (
              <li key={pt.trackId} className="flex items-baseline gap-3 px-3 py-1.5">
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                  {[showDisc && `${pt.disc}-`, showSide && pt.side, pt.position]
                    .filter(Boolean)
                    .join('')}
                </span>
                <span className="min-w-0 flex-1 truncate">{trackTitle(track)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatDuration(track.durationSeconds)}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <EmptyState>{t('Noch keine Trackliste.')}</EmptyState>
      )}
    </div>
  )
}

function ProductsTab({
  release,
  onEdit
}: {
  release: ReleaseDetailDto
  onEdit: (product: ProductDto | null) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => onEdit(null)}>
          <Plus className="h-3.5 w-3.5" />
          {t('Produkt hinzufügen')}
        </Button>
      </div>
      {release.products.length === 0 ? (
        <EmptyState>
          {t('Noch keine Produkte. Jede Ausgabe mit eigener UPC/EAN ist ein Produkt.')}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {release.products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              tracks={release.tracks}
              onEdit={() => onEdit(product)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Per track: who wrote it and with which share */
function RightsTab({
  release,
  onEdit
}: {
  release: ReleaseDetailDto
  onEdit: (track: TrackDto) => void
}) {
  if (release.tracks.length === 0) return <EmptyState>{t('Noch keine Tracks.')}</EmptyState>
  return (
    <div className="space-y-6">
      {release.tracks.map((track) => {
        const totals = [...shareTotals(track.workShares)].filter(
          ([, total]) => Math.abs(total - 100) > 0.01
        )
        return (
          <section key={track.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 border-b pb-1">
              <h3 className="font-semibold">
                <span className="mr-2 tabular-nums text-muted-foreground">{track.position}</span>
                {trackTitle(track)}
              </h3>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onEdit(track)}>
                <Pencil className="h-3.5 w-3.5" />
                {t('Bearbeiten')}
              </Button>
            </div>
            {track.workShares.length === 0 ? (
              <EmptyState>{t('Keine Urheber eingetragen.')}</EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-normal">{t('Name')}</th>
                    <th className="py-1 pr-3 font-normal">{t('Anteil an')}</th>
                    <th className="py-1 pr-3 text-right font-normal">%</th>
                    <th className="py-1 pr-3 font-normal">{t('Verwertungsgesellschaft')}</th>
                    <th className="py-1 pr-3 font-normal">IPI</th>
                    <th className="py-1 pr-3 font-normal">{t('Verlag')}</th>
                    <th className="py-1 font-normal">{t('Land')}</th>
                  </tr>
                </thead>
                <tbody>
                  {track.workShares.map((share) => (
                    <tr key={share.id}>
                      <td className="py-1 pr-3">{share.name}</td>
                      <td className="py-1 pr-3">{WORK_ROLE_LABELS[share.role]}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {share.sharePercent === null
                          ? '-'
                          : String(share.sharePercent).replace('.', ',')}
                      </td>
                      <td className="py-1 pr-3">{share.society || '-'}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{share.ipi || '-'}</td>
                      <td className="py-1 pr-3">{share.publisher || '-'}</td>
                      <td className="py-1">{share.country || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {totals.map(([role, total]) => (
              <p key={role} className="text-sm text-amber-700">
                {t('Die Anteile für {{role}} ergeben {{total}} % statt 100 %.', {
                  role: WORK_ROLE_LABELS[role as keyof typeof WORK_ROLE_LABELS] ?? role,
                  total: String(Math.round(total * 100) / 100).replace('.', ',')
                })}
              </p>
            ))}
          </section>
        )
      })}
    </div>
  )
}

/** #289: the measures for this release (from its label copy's budget, or added here) */
function MarketingTab({ release }: { release: ReleaseDetailDto }) {
  if (release.bandId === null)
    return (
      <EmptyState>
        {t('Maßnahmen gehören zu einer Band. Ordne das Release einer Band zu (Bearbeiten).')}
      </EmptyState>
    )
  return (
    <MarketingActions
      scope={{ releaseId: release.id }}
      bandId={release.bandId}
      preset={{ releaseId: release.id, release: release.title }}
      compact
    />
  )
}

/** What dialog is open; the key makes a dialog start fresh for each track or product */
type Editing =
  | { kind: 'track'; track: TrackDto | null; key: number }
  | { kind: 'product'; product: ProductDto | null; key: number }
  | { kind: 'credits'; key: number }
  | null

/** #289: one release with its label copy in tabs */
export default function ReleaseDetailPage() {
  const { releaseId } = useParams({ strict: false }) as { releaseId?: string }
  const id = parseRecordId(releaseId)
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<ReleaseDto>()
  const [editing, setEditing] = useState<Editing>(null)
  const query = trpcReact.release.getById.useQuery(id ?? 0, { enabled: id !== null })
  const documents = trpcReact.document.listByOwner.useQuery(
    { ownerType: 'release', ownerId: id ?? 0 },
    { enabled: id !== null }
  )

  const mutations = useRecordMutations({
    procedures: trpcReact.release,
    utils: utils.release,
    noun: t('Release'),
    label: (release: ReleaseDto) => release.title,
    deleteInput: (release: ReleaseDto) => release.id,
    onSaved: sheet.close,
    onDeleted: () => navigate({ to: '/releases' })
  })

  const open = (next: NonNullable<Editing>) => setEditing(next)
  const close = (isOpen: boolean) => !isOpen && setEditing(null)

  return (
    <RecordDetailPage
      id={id}
      query={query}
      loading={t('Release wird geladen…')}
      notFound={{
        text: t('Release nicht gefunden.'),
        backLabel: t('Zurück zu den Releases'),
        onBack: () => navigate({ to: '/releases' })
      }}
    >
      {(release) => (
        <RecordDetail
          record={{ type: 'release', id: release.id, name: releaseTitle(release) }}
          back={{ label: t('Alle Releases'), onBack: () => navigate({ to: '/releases' }) }}
          subtitle={[
            release.artist,
            RELEASE_TYPE_LABELS[release.releaseType],
            release.releaseDate && formatShortDate(release.releaseDate),
            release.labelShown
          ]
            .filter(Boolean)
            .join(' · ')}
          onEdit={() => sheet.openEdit(release)}
          onDelete={() => mutations.deleteNow(release)}
          deleting={mutations.isDeleting}
          isTab={isReleaseTab}
          tabs={[
            {
              id: 'overview',
              label: t('Übersicht'),
              content: (
                <OverviewTab
                  release={release}
                  onEditCredits={() => open({ kind: 'credits', key: Date.now() })}
                />
              )
            },
            {
              id: 'tracks',
              label: t('Tracks'),
              count: release.tracks.length,
              content: (
                <TracksTab
                  release={release}
                  onEdit={(track) => open({ kind: 'track', track, key: Date.now() })}
                />
              )
            },
            {
              id: 'products',
              label: t('Produkte'),
              count: release.products.length,
              content: (
                <ProductsTab
                  release={release}
                  onEdit={(product) => open({ kind: 'product', product, key: Date.now() })}
                />
              )
            },
            {
              id: 'rights',
              label: t('Rechte'),
              content: (
                <RightsTab
                  release={release}
                  onEdit={(track) => open({ kind: 'track', track, key: Date.now() })}
                />
              )
            },
            { id: 'marketing', label: t('Marketing'), content: <MarketingTab release={release} /> }
          ]}
          documents={{
            count: documents.data?.length,
            title: t('Dokumente des Releases'),
            extra: (
              <p className="text-sm text-muted-foreground">
                {t(
                  'Lege hier die Labelcopy als PDF oder Excel ab, so bleibt das Original erhalten.'
                )}
              </p>
            )
          }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title={t('Release bearbeiten')}
            description={t('Kopfdaten des Releases aktualisieren.')}
          >
            <ReleaseForm
              mode="edit"
              initialData={sheet.selectedItem}
              onSubmit={mutations.submit}
              onCancel={sheet.close}
              isSubmitting={mutations.isSubmitting}
            />
          </FormSheet>
          {editing?.kind === 'track' && (
            <TrackDialog
              key={editing.key}
              releaseId={release.id}
              track={editing.track}
              open
              onOpenChange={close}
            />
          )}
          {editing?.kind === 'product' && (
            <ProductDialog
              key={editing.key}
              releaseId={release.id}
              product={editing.product}
              tracks={release.tracks}
              open
              onOpenChange={close}
            />
          )}
          {editing?.kind === 'credits' && (
            <CreditsDialog
              key={editing.key}
              releaseId={release.id}
              credits={release.credits}
              open
              onOpenChange={close}
            />
          )}
        </RecordDetail>
      )}
    </RecordDetailPage>
  )
}
