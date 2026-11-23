import type { ReactNode } from 'react'
import {
  LabelTerms,
  type BandAgreementPrintData,
  type LabelRoyaltyTier
} from '../../../../main/api/schemas/band_agreement.schema'
import { PagedDocument } from '../print/PagedDocument'
import type { DocumentLang } from '../print/DocumentLanguageSelect'
import { PartyLines, SignatureBlocks } from './agreementParts'

// ========================================
// Label head of agreement (term sheet of a record deal)
// ========================================

// English: the wording of the English head of agreement the user provided (legally reviewed),
// a sheet of terms followed by the Owner's warranty. The template's label, band, numbers and
// place are replaced by the record's parties and terms; its offers of a shop and a publishing
// deal print only when ticked. German: a translation of that wording for this app, not
// lawyer-reviewed (listed in docs/CONTRACT_TRANSLATIONS.md).

type Data = BandAgreementPrintData & { agreement: { kind: 'label'; terms: LabelTerms } }

const DEFAULTS = LabelTerms.parse({})

/** The template's English defaults of the free-text terms, in German (Translated:) */
const GERMAN_DEFAULTS: Partial<Record<keyof LabelTerms, string>> = {
  rights: 'Exklusive physische und digitale Auswertung',
  territory: 'Welt',
  term: '1 neues Studioalbum (mind. 90 % der Songs vom Owner geschrieben und eingespielt und bisher unveröffentlicht)',
  packagingDeduction:
    '0 % für Jewel-Case-CDs / 10 % für CD-Digipak und LP-Sleeve / 15 % für Gatefold, Trifold, Shape, Liquid und Boxsets',
  freeCopies:
    '25 Exemplare jeder nicht limitierten Konfiguration; 1 Exemplar jeder anderen limitierten Konfiguration für jedes Bandmitglied, zzgl. Versand und Verpackung'
}

/** A free-text term as printed: an unchanged default reads German on a German sheet */
function termText(
  terms: LabelTerms,
  key: keyof typeof GERMAN_DEFAULTS,
  lang: DocumentLang
): string {
  const value = String(terms[key] ?? '')
  if (lang === 'de' && value === DEFAULTS[key]) return GERMAN_DEFAULTS[key] ?? value
  return value
}

function formatNumber(value: number, lang: DocumentLang): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB').format(value)
}

function formatEuro(value: number, lang: DocumentLang): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(value)
}

function formatPercent(value: number, lang: DocumentLang): string {
  const n = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: 2
  }).format(value)
  return lang === 'de' ? `${n} %` : `${n}%`
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="break-inside-avoid align-top">
      <td className="w-[52mm] py-1.5 pr-4 font-semibold">{label}:</td>
      <td className="py-1.5">{children}</td>
    </tr>
  )
}

/** Royalty tiers as lines: the first "of the net ARP", each further one "after N sold …" */
function royaltyLines(
  tiers: LabelRoyaltyTier[],
  unit: { de: string; en: string },
  lang: DocumentLang
): ReactNode {
  const sorted = [...tiers].sort((a, b) => a.from - b.from)
  if (sorted.length === 0) return '________'
  return sorted.map((tier, index) => (
    <div key={index}>
      {formatPercent(tier.percent, lang)}
      {tier.from > 0
        ? lang === 'de'
          ? ` ab ${formatNumber(tier.from, lang)} verkauften ${unit.de} vom maßgeblichen Netto-ARP`
          : ` after ${formatNumber(tier.from, lang)} ${unit.en} of the applicable net ARP`
        : lang === 'de'
          ? ' vom maßgeblichen Netto-ARP'
          : ' of the applicable net ARP'}
    </div>
  ))
}

export function LabelAgreementDocument({
  data,
  lang,
  letterheadUrl
}: {
  data: Data
  lang: DocumentLang
  letterheadUrl?: string
}) {
  const { agreement, band, artist, company } = data
  const terms = agreement.terms
  const tx = (de: ReactNode, en: ReactNode) => (lang === 'de' ? de : en)
  const pct = (value: number) => formatPercent(value, lang)
  const owner = band.name
  const licensee = company?.name ?? tx('(Label nicht gewählt)', '(no label chosen)')

  // "1-4,999 sold copies: € 5,000": each tier runs up to the next one's start
  const advances = [...terms.optionAdvances].sort((a, b) => a.fromCopies - b.fromCopies)
  const advanceLines = advances.map((tier, index) => {
    const next = advances[index + 1]
    const from = formatNumber(Math.max(tier.fromCopies, 1), lang)
    const range = next
      ? `${from}–${formatNumber(next.fromCopies - 1, lang)}`
      : `${formatNumber(Math.max(tier.fromCopies, 1), lang)}+`
    return (
      <div key={index}>
        {tx(
          `${range} verkaufte Exemplare zum High- oder Mid-Price des vorherigen Albums: ${formatEuro(tier.amount, 'de')}`,
          `${range} sold copies on high or mid price of previous album: ${formatEuro(tier.amount, 'en')}`
        )}
      </div>
    )
  })

  return (
    <PagedDocument>
      {letterheadUrl && (
        <img
          src={letterheadUrl}
          alt=""
          className="mb-4 ml-auto max-h-[20mm] max-w-[60mm] object-contain"
        />
      )}

      {/* Template: title and parties */}
      <h1 className="mb-6 text-center text-[16pt] font-bold tracking-wide">
        {tx('ECKPUNKTEVEREINBARUNG (Head of Agreement)', 'HEAD OF AGREEMENT')}
      </h1>

      <div className="mb-6 space-y-3 text-center text-[10pt]">
        <p>{tx('zwischen', 'between')}</p>
        <PartyLines party={company} fallback={licensee as string} />
        <p>{tx('und', 'and')}</p>
        <PartyLines party={artist} fallback={owner} />
        <p>{tx(`Band ${owner}`, `Band ${owner}`)}</p>
      </div>

      <table className="w-full text-[10pt] leading-snug">
        <tbody>
          <Row label={tx('Rechteinhaber (Owner)', 'Owner') as string}>{owner}</Row>
          <Row label={tx('Lizenznehmer (Licensee)', 'Licensee') as string}>{licensee}</Row>
          <Row label={tx('Rechte', 'Rights') as string}>{termText(terms, 'rights', lang)}</Row>
          <Row label={tx('Gebiet', 'Territory') as string}>
            {termText(terms, 'territory', lang)}
          </Row>
          <Row label={tx('Titelexklusivität', 'Title exclusivity') as string}>
            {terms.titleExclusivity || '________'}
          </Row>
          <Row label={tx('Auswertungsdauer', 'Exploitation time') as string}>
            {terms.exploitationTime || '________'}
          </Row>
          <Row label={tx('Vertragsumfang (Term)', 'Term') as string}>
            {termText(terms, 'term', lang)}
          </Row>
          <Row label={tx('Album-Optionen', 'Album options') as string}>
            {terms.albumOptions}{' '}
            {tx(
              '(Bonus-Discs, DVDs, Wiederveröffentlichungen, Mini-, Live- und Best-of-Alben zählen nicht als Option)',
              '(Bonus Discs, DVDs, Re-releases, Mini-, Live- and Best of etc. albums don’t count as option)'
            )}
          </Row>
          {advanceLines.length > 0 && (
            <Row label={tx('Vorschuss für Optionsalben', 'Option album advances') as string}>
              <div className="mb-1">
                {tx(
                  'Für Optionsalben verrechenbare Vorschusszahlung (100 %) für Aufnahmen, Mastering und Cover/Layout, Fotos:',
                  'For optional albums recoupable advance payment (100%) for recordings, mastering and cover/layout, photos:'
                )}
              </div>
              {advanceLines}
            </Row>
          )}
          <Row
            label={tx('Lizenzsatz physische Verkäufe', 'Royalty rate for physical sales') as string}
          >
            {royaltyLines(terms.physicalRoyalties, { de: 'Alben', en: 'sold albums' }, lang)}
          </Row>
          <Row
            label={tx('Lizenzsatz digitale Verkäufe', 'Royalty rate for digital sales') as string}
          >
            {royaltyLines(
              terms.digitalRoyalties,
              { de: 'Album-Streams', en: 'Album Streams' },
              lang
            )}
          </Row>
          <Row label={tx('Verpackungsabzug', 'Packaging deduction') as string}>
            {termText(terms, 'packagingDeduction', lang) || '________'}
          </Row>
          <Row label={tx('ARP (Actual Realized Price)', 'ARP (Actual Realized Price)') as string}>
            {tx(
              'die tatsächlich erzielten Nettopreise (nach Abzug aller Rabatte, Nachlässe und Anpassungen)',
              'the actual realized net prices (after all discounts, rebates, and adjustments have been applied)'
            )}
          </Row>
          <Row label={tx('Lizenzsatz Sublizenzierung', 'Royalty rate for sublicensing') as string}>
            {tx(
              `${pct(terms.sublicensingPercent)} der Nettoeinnahmen`,
              `${pct(terms.sublicensingPercent)} of net income`
            )}
          </Row>
          <Row label={tx('Abrechnung / Zahlungen', 'Royalty accounting / payments') as string}>
            {tx(
              `alle ${terms.accountingMonths} Monate innerhalb von ${terms.accountingDays} Tagen`,
              `every ${terms.accountingMonths} months within ${terms.accountingDays} days`
            )}
            {terms.returnsReservePercent > 0 && (
              <div>
                {tx(
                  `Retourenreserve von ${pct(terms.returnsReservePercent)}, die einbehalten und nach weiteren ${terms.accountingMonths} Monaten innerhalb von ${terms.accountingDays} Tagen ausgezahlt werden kann`,
                  `Retour reserve of ${pct(terms.returnsReservePercent)} retained with possible payout after ${terms.accountingMonths} additional months within ${terms.accountingDays} days`
                )}
              </div>
            )}
          </Row>
          <Row label={tx('Freiexemplare', 'Free copies') as string}>
            {termText(terms, 'freeCopies', lang) || '________'}
          </Row>
          {terms.artistPrices.trim() && (
            <Row label={tx('Preis für CD/Vinyl', 'Price for CD/Vinyl') as string}>
              <div className="whitespace-pre-wrap">{terms.artistPrices.trim()}</div>
              <div className="mt-1">
                {tx(
                  'Die Preise enthalten die Band-Lizenz – keine Auszahlung in der Abrechnung.',
                  'Prices include band royalty – no payout in statement.'
                )}
              </div>
            </Row>
          )}
          {terms.merchandise.trim() && (
            <Row label={tx('Optionales Merchandise', 'Optional Merchandise') as string}>
              <div className="whitespace-pre-wrap">{terms.merchandise.trim()}</div>
            </Row>
          )}
          {terms.offerOnlineStore && (
            <Row label={tx('Online-Shop', 'Online Store') as string}>
              {tx(
                `Ein Shop-Deal über ${licensee} kann angeboten werden (einschließlich Kundenservice, Tour-Support, Lager, Herstellung, Logistik, Produktentwicklung …).`,
                `We can offer a shop deal via ${licensee} (including customer service, tour support, warehouse, manufacture, logistics, product development…).`
              )}
            </Row>
          )}
          {terms.offerPublishing && (
            <Row label={tx('Verlag', 'Publishing') as string}>
              {tx(
                `Ein Verlagsdeal über ${licensee} kann angeboten werden.`,
                `We can offer a publishing deal via ${licensee}.`
              )}
            </Row>
          )}
        </tbody>
      </table>

      {agreement.specialClauses.trim() && (
        <div className="mt-4 text-[10pt]">
          <p className="font-semibold">{tx('Sondervereinbarungen', 'Special Agreements')}:</p>
          <p className="whitespace-pre-wrap">{agreement.specialClauses}</p>
        </div>
      )}

      {/* Template: the Owner's warranty */}
      <p className="mt-6 break-inside-avoid text-justify text-[10pt] leading-relaxed">
        {tx(
          `Der Owner bestätigt hiermit, dass die Mitglieder der Band ${owner} das volle, uneingeschränkte Recht, die Befugnis und die Vollmacht besitzen, diese Vereinbarung abzuschließen und zu erfüllen. Der Owner sichert ferner zu, gewährleistet und verpflichtet sich, den Lizenznehmer und dessen Lizenznehmer von sämtlichen Verpflichtungen zu Kosten, Ausgaben oder Auslagen im Zusammenhang mit Klagen, Verfahren oder Ansprüchen freizustellen und schadlos zu halten, die sich aus Ansprüchen oder Forderungen ehemaliger Partner ergeben.`,
          `Owner herewith confirms that the members in the band ${owner} possess the full unlimited right, power and authority to enter into and to perform this Agreement and Owner further warrants, represents and agrees that it will indemnify and hold harmless Licensee and its licensees of and from any and all obligations to any costs, expenses or disbursements with respect to any suit, actions, proceeding or claim arising from any claims or demands of former partners.`
        )}
      </p>

      <SignatureBlocks
        placeDate={tx('Ort, Datum', 'City, Date') as string}
        left={{
          role: tx('Lizenznehmer', 'Licensee') as string,
          name: company?.name ?? '',
          city: company?.city ?? ''
        }}
        right={{
          role: tx('Owner', 'Owner') as string,
          name: artist?.name ?? owner,
          city: artist?.city ?? ''
        }}
      />
    </PagedDocument>
  )
}
