import { useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { keepOpenOnToast } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { FieldShell } from '@/components/forms/FormFields'
import {
  RELEASE_FORMAT_LABELS,
  ReleaseFormat,
  type ContributorDto,
  type ProductDto,
  type TrackDto
} from '../../../../main/api/schemas/release.schema'
import { formatDuration } from '../../../../main/release/codes'
import { ContributorEditor, WorkShareEditor } from './ContributorEditor'
import {
  contributorDrafts,
  contributorInputs,
  productDraft,
  productInput,
  productWarnings,
  trackDraft,
  trackInput,
  trackWarnings,
  type ContributorDraft,
  type ProductDraft,
  type TrackDraft
} from './releaseDrafts'
import { trackTitle } from './releaseText'
import { t } from '../../../../main/i18n/translate'

/** Saving one part of a release: every procedure answers with the whole release */
function useReleaseSave(onDone: () => void) {
  const utils = trpcReact.useUtils()
  return {
    onSuccess: () => {
      void utils.release.invalidate()
      toast.success(t('Gespeichert'))
      onDone()
    },
    onError: (error: { message: string }) =>
      toast.error(t('Nicht gespeichert'), { description: error.message })
  }
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          {item}
        </li>
      ))}
    </ul>
  )
}

function TextInput({
  id,
  label,
  value,
  onChange,
  hint,
  className,
  ...input
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  className?: string
  placeholder?: string
  type?: string
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} className={className}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...input} />
    </FieldShell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  saving,
  onSave,
  saveLabel,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  saving: boolean
  onSave: () => void
  saveLabel: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        onInteractOutside={keepOpenOnToast}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Abbrechen')}
          </Button>
          <Button disabled={saving} onClick={onSave}>
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A track with its performers and the shares in its work */
export function TrackDialog({
  releaseId,
  track,
  open,
  onOpenChange
}: {
  releaseId: number
  /** null: a new track */
  track: TrackDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState<TrackDraft>(() => trackDraft(track))
  const set = (patch: Partial<TrackDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const save = trpcReact.release.saveTrack.useMutation(useReleaseSave(() => onOpenChange(false)))

  const submit = () => {
    const result = trackInput(releaseId, track?.id ?? null, draft)
    if ('error' in result) toast.error(result.error)
    else save.mutate(result.input)
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={track ? t('Track bearbeiten') : t('Neuer Track')}
      description={t('Titel, ISRC und Dauer, wer mitgewirkt hat und wem das Werk gehört.')}
      saving={save.isPending}
      onSave={submit}
      saveLabel={track ? t('Speichern') : t('Anlegen')}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput
          id="track-title"
          label={t('Titel')}
          value={draft.title}
          onChange={(title) => set({ title })}
        />
        <TextInput
          id="track-version"
          label={t('Version / Featuring')}
          placeholder={t('z. B. Radio Edit')}
          value={draft.version}
          onChange={(version) => set({ version })}
        />
        <TextInput
          id="track-isrc"
          label="ISRC"
          placeholder="DE-XXX-26-00001"
          value={draft.isrc}
          onChange={(isrc) => set({ isrc })}
        />
        <TextInput
          id="track-duration"
          label={t('Dauer')}
          placeholder="3:22"
          value={draft.duration}
          onChange={(duration) => set({ duration })}
        />
        <TextInput
          id="track-genre"
          label={t('Genre')}
          hint={t('Nur wenn es vom Release abweicht.')}
          value={draft.genre}
          onChange={(genre) => set({ genre })}
        />
        <TextInput
          id="track-video-isrc"
          label={t('Video-ISRC')}
          value={draft.videoIsrc}
          onChange={(videoIsrc) => set({ videoIsrc })}
        />
        <TextInput
          id="track-p-line"
          label={t('℗-Zeile')}
          hint={t('Leer lassen, wenn sie die des Releases ist.')}
          value={draft.pLine}
          onChange={(pLine) => set({ pLine })}
        />
        <TextInput
          id="track-c-line"
          label={t('©-Zeile')}
          value={draft.cLine}
          onChange={(cLine) => set({ cLine })}
        />
      </div>
      <label className="flex items-center gap-3">
        <Switch checked={draft.explicit} onCheckedChange={(explicit) => set({ explicit })} />
        {t('Explicit (anstößiger Inhalt)')}
      </label>

      <Section title={t('Mitwirkende')}>
        <ContributorEditor
          value={draft.contributors}
          onChange={(contributors) => set({ contributors })}
          addLabel={t('Mitwirkende hinzufügen')}
        />
      </Section>

      <Section title={t('Urheber und Anteile')}>
        <WorkShareEditor value={draft.workShares} onChange={(workShares) => set({ workShares })} />
      </Section>

      <Warnings items={trackWarnings(draft)} />

      <Section title={t('Songtext')}>
        <Textarea
          aria-label={t('Songtext')}
          rows={4}
          value={draft.lyrics}
          onChange={(e) => set({ lyrics: e.target.value })}
        />
      </Section>
      <Section title={t('Notiz')}>
        <Textarea
          aria-label={t('Notiz')}
          rows={2}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Section>
    </DialogShell>
  )
}

/** A product (digital, CD, vinyl …) with its codes and tracklist */
export function ProductDialog({
  releaseId,
  product,
  tracks,
  open,
  onOpenChange
}: {
  releaseId: number
  product: ProductDto | null
  tracks: TrackDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState<ProductDraft>(() => productDraft(product, tracks))
  const set = (patch: Partial<ProductDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const setTrack = (index: number, patch: Partial<ProductDraft['tracks'][number]>) =>
    set({ tracks: draft.tracks.map((row, i) => (i === index ? { ...row, ...patch } : row)) })
  const save = trpcReact.release.saveProduct.useMutation(useReleaseSave(() => onOpenChange(false)))
  const byId = new Map(tracks.map((track) => [track.id, track]))

  const submit = () => {
    const result = productInput(releaseId, product?.id ?? null, draft)
    if ('error' in result) toast.error(result.error)
    else save.mutate(result.input)
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={product ? t('Produkt bearbeiten') : t('Neues Produkt')}
      description={t(
        'Eine Ausgabe des Releases mit eigener UPC/EAN und Katalognummer: digital, CD, Vinyl, eine Single vorab …'
      )}
      saving={save.isPending}
      onSave={submit}
      saveLabel={product ? t('Speichern') : t('Anlegen')}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldShell id="product-format" label={t('Format')}>
          <Select
            value={draft.format}
            onValueChange={(format) => set({ format: format as ReleaseFormat })}
          >
            <SelectTrigger id="product-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ReleaseFormat.options.map((format) => (
                <SelectItem key={format} value={format}>
                  {RELEASE_FORMAT_LABELS[format]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
        <TextInput
          id="product-title"
          label={t('Bezeichnung')}
          placeholder={t('z. B. Single „Titel“ oder Vinyl rot')}
          value={draft.title}
          onChange={(title) => set({ title })}
        />
        <TextInput
          id="product-upc"
          label="UPC / EAN"
          inputMode="numeric"
          value={draft.upc}
          onChange={(upc) => set({ upc })}
        />
        <TextInput
          id="product-catalog"
          label={t('Katalognummer')}
          value={draft.catalogNumber}
          onChange={(catalogNumber) => set({ catalogNumber })}
        />
        <TextInput
          id="product-packaging"
          label={t('Verpackung')}
          placeholder={t('Digipak, Jewelcase, Gatefold …')}
          value={draft.packaging}
          onChange={(packaging) => set({ packaging })}
        />
        <TextInput
          id="product-color"
          label={t('Farbe / Variante')}
          value={draft.color}
          onChange={(color) => set({ color })}
        />
        <TextInput
          id="product-territory"
          label={t('Territorium')}
          placeholder={t('z. B. World')}
          value={draft.territory}
          onChange={(territory) => set({ territory })}
        />
        <TextInput
          id="product-date"
          label={t('Eigenes VÖ-Datum')}
          type="date"
          hint={t('Nur wenn es vom Release abweicht.')}
          value={draft.releaseDate}
          onChange={(releaseDate) => set({ releaseDate })}
        />
        <TextInput
          id="product-discs"
          label={t('Discs')}
          inputMode="numeric"
          value={draft.discCount}
          onChange={(discCount) => set({ discCount })}
        />
        <TextInput
          id="product-price"
          label={t('Preiscode')}
          value={draft.priceCode}
          onChange={(priceCode) => set({ priceCode })}
        />
        <TextInput
          id="product-box-lot"
          label="Box Lot"
          inputMode="numeric"
          value={draft.boxLot}
          onChange={(boxLot) => set({ boxLot })}
        />
      </div>

      <Warnings items={productWarnings(draft)} />

      <Section title={t('Trackliste')}>
        {draft.tracks.length === 0 ? (
          <p className="text-muted-foreground">
            {t('Das Release hat noch keine Tracks. Lege sie im Tab Tracks an.')}
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {draft.tracks.map((row, index) => {
              const track = byId.get(row.trackId)
              if (!track) return null
              return (
                <div key={row.trackId} className="flex items-center gap-3 px-3 py-1.5">
                  <Switch
                    checked={row.included}
                    onCheckedChange={(included) => setTrack(index, { included })}
                    aria-label={t('{{title}} gehört dazu', { title: track.title })}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {trackTitle(track)}
                    {track.durationSeconds !== null && (
                      <span className="ml-2 text-muted-foreground">
                        {formatDuration(track.durationSeconds)}
                      </span>
                    )}
                  </span>
                  <Input
                    aria-label={t('Disc')}
                    title={t('Disc')}
                    className="h-8 w-14"
                    disabled={!row.included}
                    value={row.disc}
                    onChange={(e) => setTrack(index, { disc: e.target.value })}
                  />
                  {draft.format === 'vinyl' || draft.format === 'cassette' ? (
                    <Input
                      aria-label={t('Seite')}
                      title={t('Seite')}
                      placeholder={t('Seite')}
                      className="h-8 w-16"
                      disabled={!row.included}
                      value={row.side}
                      onChange={(e) => setTrack(index, { side: e.target.value })}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title={t('Notiz')}>
        <Textarea
          aria-label={t('Notiz')}
          rows={2}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Section>
    </DialogShell>
  )
}

/** The credits of the release as a whole: production, recording, mix, mastering, photos, artwork */
export function CreditsDialog({
  releaseId,
  credits,
  open,
  onOpenChange
}: {
  releaseId: number
  credits: ContributorDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState<ContributorDraft[]>(() => contributorDrafts(credits))
  const save = trpcReact.release.saveCredits.useMutation(useReleaseSave(() => onOpenChange(false)))
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Credits bearbeiten')}
      description={t(
        'Wer am Release als Ganzes mitgewirkt hat: Produktion, Aufnahme, Mix, Mastering, Fotos, Artwork, Besetzung.'
      )}
      saving={save.isPending}
      onSave={() => save.mutate({ releaseId, contributors: contributorInputs(draft) })}
      saveLabel={t('Speichern')}
    >
      <ContributorEditor value={draft} onChange={setDraft} addLabel={t('Eintrag hinzufügen')} />
    </DialogShell>
  )
}
