import type { ContractData, ContractParty } from '../../../../main/api/schemas/contract.schema'

// ========================================
// Formatting helpers
// ========================================

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value)
}

function formatVatRate(rate: number | null): string {
  if (rate === null || rate === undefined) return ''
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(rate)
}

function AddressLines({ party }: { party: ContractParty }) {
  return (
    <div className="leading-snug">
      <div className="font-medium">{party.name}</div>
      {(party.street || party.streetNumber) && (
        <div>
          {party.street} {party.streetNumber}
        </div>
      )}
      {(party.zipCode || party.city) && (
        <div>
          {party.zipCode} {party.city}
        </div>
      )}
      {party.country && <div>{party.country}</div>}
    </div>
  )
}

// ========================================
// Section primitives (numbered headings like the reference contract)
// ========================================

function Section({
  number,
  title,
  children
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <h3 className="font-bold text-[11pt] mb-1">
        {number}. {title}
      </h3>
      <div className="space-y-2 text-[10pt] leading-relaxed">{children}</div>
    </div>
  )
}

function SubSection({
  number,
  title,
  children
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2">
      <h4 className="font-semibold text-[10pt] mb-1">
        {number} {title}
      </h4>
      <div className="space-y-2 text-[10pt] leading-relaxed">{children}</div>
    </div>
  )
}

// ========================================
// Boilerplate legal text (based on the reference engagement contract)
// ========================================

const BOILERPLATE = {
  preambleConfirm: `Diese Vereinbarung stellt eine schriftliche Bestätigung der bereits getroffenen Vereinbarungen dar und dient dazu, sämtliche den Auftritt des Künstlers betreffende Fragen im Voraus verbindlich zu klären.`,
  accountingTransfer: (vatNote: string) =>
    `Die unter Punkt 2.1 vereinbarte Gage wird wie folgt abgerechnet: Überweisung auf das Konto des Künstlers. Samtliche Zahlungen aus diesem Vertrag verstehen sich zzgl. der jeweils gesetzlichen MwSt. ${vatNote}`,
  prepaymentClause: `Geht die vereinbarte Vorauszahlung nicht zum vereinbarten Termin auf dem Konto ein, hat nur der Künstler das Recht, vom Vertrag zurückzutreten. Der Künstler behält sich für diesen Fall die Geltendmachung von Schadensersatzverpflichtungen vor.`,
  gema: `Der örtliche Veranstalter ist verpflichtet, die Veranstaltung der GEMA zu melden. Sämtliche aus der Veranstaltung anfallenden Steuern, Abgaben und GEMA-Gebühren sind zu 100% vom örtlichen Veranstalter zu zahlen.`,
  ksk: (kskNumber: string) =>
    `Für die Meldung und Abführung der KSK-Beiträge ist der örtliche Veranstalter verantwortlich${kskNumber ? `, dessen KSK-Nummer lautet: ${kskNumber}` : ''}.`,
  permits: `Der örtliche Veranstalter versichert, dass dem Gastspiel keine bau-, feuerpolizeilichen oder sonstigen Beschränkungen entgegenstehen und sich sämtliche notwendigen Genehmigungen, Arbeitserlaubnisse etc. für diese Veranstaltung auf eigene Kosten rechtzeitig einzuholen werden. Der örtliche Veranstalter garantiert, dass alle öffentlich-rechtlichen Auflagen vor, während und nach dem Gastspiel eingehalten werden.`,
  taxRegistration: `Der örtliche Veranstalter verpflichtet sich, die Veranstaltung beim Steueramt anzumelden und falls nötig die Befreiung von der Vergnügungssteuer zu beantragen. Beide Vertragspartner versteuern ihr Einkommen in Deutschland selbst.`,
  costs: `Der örtliche Veranstalter trägt sämtliche vor Ort anfallenden Kosten und die Kosten der Bühnenanweisung, wie u.a. Hallenmiete inkl. Nebenkosten, Personal, Bühne, Catering, regionale Werbung, Sicherungs- und Ordnungsdienst, Versicherungsprämie für den in seinen Bereich fallenden Versicherungsschutz, Steuern und Abgaben seines Bereiches sowie Kosten aus diesem Vertrag. Hierfür trägt er auch die alleinige Haftung und stellt den Künstler von jeder Haftung frei. Details regelt die Bühnenanweisung, die fester Bestandteil dieses Vertrages ist und in allen Punkten vom örtlichen Veranstalter zu erfüllen ist.`,
  tech: `Der örtliche Veranstalter stellt unentgeltlich eine professionelle Bühne sowie Ton- und Lichttechnik laut der verbindlichen Ton-/Licht-/Bühnenanweisung und dazugehöriges Bedienpersonal zur Verfügung. Der örtliche Veranstalter nimmt von sich aus spätestens 2 Wochen vor Konzertbeginn mit den Technikern und dem Tourleiter des Künstlers wegen genauer Absprachen Kontakt auf.`,
  staffing: `Der örtliche Veranstalter stellt laut der Ton-/Licht-/Bühnenanweisung ausreichend Personal (Techniker, Helfer, Rigger...) unentgeltlich zur Verfügung. Steht das Personal nicht oder nur unvollständig zur Verfügung, so ist der Künstler berechtigt, dem örtlichen Veranstalter zusätzlich 250 Euro zzgl. MwSt. je nicht bereitgestellter Position in Rechnung zu stellen. Die genauen Anforderungen sind der Ton-/Licht-/Bühnenanweisung zu entnehmen. Die hieraus entstehenden Kosten trägt der örtliche Veranstalter.`,
  stageSpecs: `Die gesamte Bühne muss eben sein und den Bestimmungen des TÜV entsprechen. Der Aufgang/Zugang zur Bühne muss beleuchtet sein. Der örtliche Veranstalter versichert, dass die elektrischen Anlagen den neuesten Verordnungen der VDE entsprechen. Bei Nichtbeachtung dieses Punktes trägt er alle Folgen der sich dadurch ergebenden Schäden. Während der Betriebszeit der Anlage darf die Stromzufuhr nur mit Genehmigung der Techniker des Künstlers unterbrochen werden. Der örtliche Veranstalter stellt Absperrgitter (Crash Barriers - keine Polizeigitter!) zwischen Bühne und Publikum zu seinen Kosten.`,
  presence: `Am Tag des Konzertes muss ein Verantwortlicher des örtlichen Veranstalters vom Get-In bis zum Ende der Veranstaltung, des Abbaus und des Ladens vor Ort anwesend sein.`,
  accommodation: (rooms: string) =>
    `Der örtliche Veranstalter stellt und trägt die Kosten für Übernachtung mit Frühstück in einem guten Mittelklasse-Hotel für die Künstler und Crew. ${rooms}`,
  nightliner: `Sollte der Künstler kurzfristig mit dem Nightliner anreisen oder aus logistischen Gründen weiterreisen müssen, so wird hierfür eine Übernachtungspauschale i.H. der Hotelkosten vereinbart, mind. jedoch 500,00 Euro zzgl. gesetzlicher MwSt., die der örtliche Veranstalter an den Künstler zu zahlen hat.`,
  catering: `Der örtliche Veranstalter stellt und trägt die Kosten für ausreichend Catering für den Künstler und dessen Crew sowie Support wie in der verbindlichen Cateringanweisung gefordert. Die Cateringanweisung ist Bestandteil des Vertrags und muss zu 100% erfüllt werden. Abweichungen sind nur nach schriftlicher Rücksprache mit dem Tourmanagement möglich.`,
  artisticFreedom: `Die Art der Darbietung und Gestaltung liegt ausschließlich beim Künstler; künstlerischen Weisungen des örtlichen Veranstalters oder eines Dritten unterliegen sie nicht. Der Künstler ist nur an die durch diesen Vertrag vereinbarten Regelungen gebunden. Die Zahlung der vertragsgegenständlichen Vergütung ist unabhängig vom Erfolg des Künstlers in seiner Darbietung beim Publikum.`,
  sponsorship: `Handelt es sich beim örtlichen Veranstalter um eine Partei, eine Firma, einen Verband, einen eingetragenen Verein oder um eine parteinahme Organisation etc., so ist dies vor Vertragsabschluss ausdrücklich bekanntzugeben. Die Beteiligung jedweder Sponsoren oder Präsentatoren oder sonstiger Werbeträger bedarf der schriftlichen Absprache mit dem Künstler. Jegliche Werbemittel wie Banner, Plakate, Fahnen und dergleichen im unmittelbaren Bühnenbereich sind grundsätzlich nicht gestattet.`,
  organization: `Der örtliche Veranstalter sorgt für einen ungehinderten organisatorischen Ablauf der gesamten Veranstaltung. Der örtliche Veranstalter haftet ab Aufbaubeginn bis Abbauende in voller Höhe für etwaige Körper- und Sachschäden (Instrumente, Anlage etc.) durch Dritte am Künstler. Es wird empfohlen, dass der örtliche Veranstalter für die Veranstaltung eine Haftpflichtversicherung für Personen- und Sachschäden abschließt. Der örtliche Veranstalter stellt den Künstler von jeder Haftung frei. Der Künstler haftet nur für Schäden, die durch ihn, seine Techniker oder Mitarbeiter schuldhaft verursacht werden.`,
  security: `Der örtliche Veranstalter garantiert für seine Veranstaltung ein genehmigtes Sicherheitskonzept, ebenso ausreichend professionelle, geschulte, nüchterne und volljährige Ordnungskräfte zur Sicherung des Backstage-, Bühnen-, Licht- bzw. Tonpultes und Eingangsbereiches, außerdem selbstsichernde Barrieren (Crash Barriers) vor der Bühne. Keine Polizeigitter! Weisungen des Tourleiters an die Security ist Folge zu leisten. Bei Konzertveranstaltungen besteht auf Grund der Lautstärke die Gefahr von Hör- und Gesundheitsschäden.`,
  advertising: `Der örtliche Veranstalter sorgt für eine adäquate Werbung (Presse, Funk, Flyer, Anzeigen, Online, Plakatwerbung). Der örtliche Veranstalter erhält hierfür kostenloses Pressematerial.`,
  cancellation: (fee: string) =>
    `Für jeden einzelnen Fall, dass infolge einer dem örtlichen Veranstalter zurechenbaren schuldhaften Handlung oder Unterlassung, insbesondere Vertragsbruch, Rücktritt vom Vertrag, oder sonstiger vom örtlichen Veranstalter zu vertretender Umstände (z.B. Abbruch des Konzerts wegen randalierender Gäste etc.) das vereinbarte Konzert oder der Auftritt des Künstlers nicht oder nur teilweise stattfindet, verpflichtet sich der örtliche Veranstalter zur Zahlung einer Vertragsstrafe in Höhe von ${fee} pro ausgefallenem Konzert/Auftritt und leistet Schadensersatz in Höhe von 500,00 Euro für Nightliner/Hotel/Übernachtung, sofern nicht der Künstler einen höheren Schaden oder der örtliche Veranstalter einen geringeren Schaden nachweist. Die Geltendmachung eines weitergehenden Schadens wird durch die vorstehende Schadenspauschalierung nicht ausgeschlossen.`,
  forceMajeure: `Fälle höherer Gewalt einschließlich Krankheit der Künstler, behördlicher Maßnahmen, Streiks, Betriebsstörungen, Ausfall bzw. Verspätung von Verkehrsmitteln und alle sonstigen vom Künstler nicht zu vertretenden Umstände, die die Gestellung des Künstlers oder der Technik unmöglich machen oder übermäßig erschweren, entbinden den Künstler von der Verpflichtung zur Vertragserfüllung. Ansprüche jedweder Art können daraus nicht hergeleitet werden. Jeder Vertragspartner trägt die ihm entstandenen Aufwendungen selbst.`,
  insurance: `Der örtliche Veranstalter versichert, dass er eine im Zusammenhang mit der Veranstaltung sowie seinen vertraglichen Pflichten stehende entsprechende Veranstalterhaftpflicht-, Unfall- und Ausfallversicherung in angemessener Deckungshöhe abgeschlossen hat. Der örtliche Veranstalter hat auf Anfrage des Künstlers die entsprechende(n) Versicherungspolice(n) rechtzeitig vor Beginn der Veranstaltung vorzulegen.`,
  resale: `Der örtliche Veranstalter ist nicht befugt, dieses Gastspiel ganz und/oder teilweise ohne vorherige schriftliche Zustimmung des Künstlers an Dritte zu veräußern und/oder ohne vorherige schriftliche Zustimmung des Künstlers Gelder aus den Vorverkaufseinnahmen des diesem Vertrage unterfallenden Gastspiels zu entnehmen.`,
  merch: `Der Künstler hat das alleinige Verkaufsrecht für Merchandisingartikel. Es fallen hierzu für den Künstler keine Gebühren für Standmiete oder Ähnliches an. Für Merchandising stellt der örtliche Veranstalter unentgeltlich einen gut sichtbaren, überdachten Platz (mind. 5 x 2 Meter breit) mit Tisch und 220V Stromanschluss zur Verfügung. Der Verkauf von Artikeln durch Dritte kann nur mit ausdrücklicher Genehmigung des Künstlers geschehen.`,
  recordings: `Die Veranstaltung darf weder durch den örtlichen Veranstalter noch durch einen Dritten ohne schriftliche Zustimmung des Künstlers audiovisuell oder audio-only (Video, Film, Ton und/oder durch ein sonstiges Aufnahmesystem) auf Ton- und/oder Bildtonträgern aufgezeichnet werden. Etwaige Anfragen sind bis spätestens 14 (vierzehn) Tage vor der Veranstaltung an das Management zu stellen.`,
  guestList: `Der Künstler erhält bei Bedarf bis zu 10 Freikarten bzw. gibt eine Gästeliste vor Konzertbeginn ab. Zusätzlich erhalten alle Personen, welche die Veranstaltung aus beruflichen Gründen besuchen (Presse, Label, Agentur o.ä.) freien Eintritt. Die Gästeliste wird vom Tourmanager erstellt und vor Ort abgegeben.`,
  legalRelation: `Ein Rechtsverhältnis aus diesem Vertrag kommt ausschließlich zwischen dem Künstler und dem örtlichen Veranstalter zustande. Die Rechtsbeziehungen der Vertragspartner unterliegen deutschem Recht.`,
  preparation: `Um eine bestmögliche Vorbereitung für das Konzert gewährleisten zu können, versichert der örtliche Veranstalter, folgende Unterlagen bis spätestens 2 Wochen vor dem oben genannten Konzert an den Künstler zu senden: Technik- und Materialauflistung mit der vor Ort gestellten Technik; vollständige Running Order/Zeitplan mit allen auftretenden Künstlerinnen und Künstlern; Kontaktliste mit allen örtlichen Ansprechpartnern (Bandbetreuung, Technischer Leiter, Accounting...); alle weiteren sonstigen wichtigen und relevanten Infos zur Location und Veranstaltung.`,
  general: `Der örtliche Veranstalter versichert, dass er volljährig, geschäftsfähig und berechtigt ist, die Vereinbarung zu unterzeichnen. Änderungen, Ergänzungen der Vereinbarung oder Sondervereinbarungen werden nur wirksam, wenn sie zwischen den Vertragspartnern schriftlich festgelegt sind. Sollten Teile dieser Vereinbarung nichtig sein oder rechtsunwirksam werden, so gilt der Rechtsvertrag weiter. Die nichtigen oder rechtsunwirksamen Teile der Vereinbarung sollen dann so ausgelegt werden, dass im Ganzen der Sinn der Vereinbarung erhalten bleibt. Weitere Nebenabsprachen sind nicht getroffen worden. Im Zweifel gelten die bei Konzerten üblichen Gepflogenheiten. Beide Vertragspartner verpflichten sich, Stillschweigen gegenüber allen Dritten bzgl. des Inhalts dieser Vereinbarung zu wahren.`
}

// ========================================
// Contract document
// ========================================

export function ContractDocument({
  data,
  artistImageUrl
}: {
  data: ContractData
  artistImageUrl?: string
}) {
  const { dealMemo, band, artist, promoter, venue, hotel } = data

  const guarantee = dealMemo.guaranteeAmount
  const vatRate = dealMemo.guaranteeVatRate
  const guaranteeWithVat =
    guarantee !== null && vatRate !== null ? guarantee * (1 + vatRate / 100) : guarantee
  const feeText =
    guarantee !== null
      ? `eine Garantiezahlung in Höhe von ${formatMoney(guarantee)}${
          vatRate !== null && vatRate > 0 ? ` zzgl. ${formatVatRate(vatRate)} % MwSt.` : ''
        }`
      : 'die gemäß den getroffenen Absprachen vereinbarte Gage'

  const roomsText = dealMemo.roomInformation
    ? `Zimmeraufteilung: ${dealMemo.roomInformation}${
        dealMemo.amountOfPeople ? ` (insgesamt ${dealMemo.amountOfPeople} Personen)` : ''
      }${hotel ? `, Hotel: ${hotel.name}` : ''}.`
    : 'Die Zimmeraufteilung wird separat vereinbart.'

  return (
    <div className="relative mx-auto w-[210mm] min-h-[297mm] bg-white p-[20mm] text-black shadow-lg print:shadow-none print:m-0 print:w-auto print:min-h-0">
      {/* Letterhead: artist identity */}
      {artistImageUrl && (
        <img
          src={artistImageUrl}
          alt=""
          className="mb-6 ml-auto max-h-[20mm] max-w-[60mm] object-contain"
        />
      )}

      {/* Header: parties */}
      <div className="grid grid-cols-2 gap-8 text-[10pt] leading-snug mb-8">
        <div>
          <div className="font-bold mb-1">Künstler / Artist:</div>
          {artist ? <AddressLines party={artist} /> : <div>{band?.name ?? '-'}</div>}
        </div>
        <div>
          <div className="font-bold mb-1">Örtlicher Veranstalter:</div>
          {promoter ? <AddressLines party={promoter} /> : <div>-</div>}
        </div>
      </div>

      <h1 className="text-center text-[15pt] font-bold mb-6 tracking-wide">AUFTRITTSVERTRAG</h1>

      <p className="text-[10pt] leading-relaxed mb-4">
        zwischen
        {artist && (
          <>
            {' '}
            <span className="font-semibold">{artist.name}</span>
            {promoter?.representative ? (
              <>, vertreten durch {promoter.representative},</>
            ) : (
              <> (im Auftrag und in Vertretung der Gruppe {band?.name ?? '-'})</>
            )}
          </>
        )}
        - nachfolgend „Künstler“ genannt -
      </p>
      <p className="text-[10pt] leading-relaxed mb-4">
        und dem örtlichen Veranstalter:
        {promoter && (
          <>
            {' '}
            <span className="font-semibold">{promoter.name}</span>
            {promoter.representative && <>vertreten durch {promoter.representative}</>}
          </>
        )}
        {promoter?.kskNumber && (
          <>
            <br />
            Künstlersozialkassen-Nummer des örtlichen Veranstalters: {promoter.kskNumber}
          </>
        )}
        - nachfolgend „ÖV“ genannt -
      </p>
      <p className="text-[10pt] leading-relaxed mb-6">
        wird gemäß der im Vorfeld getroffenen Absprachen Folgendes vereinbart:
      </p>

      {/* 1. Engagement */}
      <Section number={1} title="Engagement">
        <p>
          Gegenstand dieses Vertrags ist der Auftritt von Künster*in/Band/Artist{' '}
          <span className="font-semibold">{band?.name ?? '-'}</span> bei der von „ÖV“ ausgerichteten
          Veranstaltung zu den hier aufgeführten Bedingungen:
        </p>
        <p>
          <span className="font-semibold">Veranstaltungsdatum:</span> {formatDate(dealMemo.date)}
          <br />
          <span className="font-semibold">Veranstaltungsort:</span> {venue?.city || '-'}
          <br />
          <span className="font-semibold">Location:</span> {venue?.name || '-'}
        </p>
        <p>{BOILERPLATE.preambleConfirm}</p>
      </Section>

      {/* 2. Gage */}
      <Section number={2} title="Artist/Künstlerinnengage/Produktionskosten">
        <SubSection number="2.1" title="">
          <p>Als Gage für den „Künstler“, die der „ÖV“ zu zahlen hat, ist vereinbart: {feeText}.</p>
        </SubSection>
        <p>
          Als Nettoeinnahme aus dem Kartenabverkauf verstehen beide Parteien die um die gesetzliche
          MwSt. und sonstiger Ticketkosten und/oder Gebühren etc. bereinigten Ticketgelder lt.
          Rapport.
        </p>
      </Section>

      {/* 3. Abrechnung */}
      <Section number={3} title="Abrechnung">
        <p>
          {BOILERPLATE.accountingTransfer(
            guaranteeWithVat !== null && vatRate !== null && vatRate > 0
              ? `Vorkasse auf die Gage: ${formatMoney(guaranteeWithVat ?? 0)} (inkl. MwSt.) bis spätestens ${formatDate(dealMemo.date)}.`
              : ''
          )}
        </p>
        <p>{BOILERPLATE.prepaymentClause}</p>
      </Section>

      {/* 4. GEMA, KSK, Steuern */}
      <Section number={4} title="Anmeldungen, GEMA, KSK, Steuern, Leistungen von ÖV">
        <p>{BOILERPLATE.gema}</p>
        <p>{BOILERPLATE.ksk(promoter?.kskNumber ?? '')}</p>
        <p>{BOILERPLATE.permits}</p>
        <p>{BOILERPLATE.taxRegistration}</p>
        <p>{BOILERPLATE.costs}</p>
      </Section>

      {/* 5. Technik/Personal */}
      <Section number={5} title="Technik/Personal/Bühnenanweisung">
        <p>{BOILERPLATE.tech}</p>
        <p>{BOILERPLATE.staffing}</p>
        <p>{BOILERPLATE.stageSpecs}</p>
        <p>{BOILERPLATE.presence}</p>
      </Section>

      {/* 6. Anreise/Übernachtung */}
      <Section number={6} title="Anreise und Übernachtung">
        <p>{BOILERPLATE.accommodation(roomsText)}</p>
        <p>{BOILERPLATE.nightliner}</p>
      </Section>

      {/* 7. Catering */}
      <Section number={7} title="Catering">
        <p>{BOILERPLATE.catering}</p>
      </Section>

      {/* 8. Künstlerische Freiheit */}
      <Section number={8} title="Künstlerische Freiheit">
        <p>{BOILERPLATE.artisticFreedom}</p>
      </Section>

      {/* 9. Supportband/Slot */}
      <Section number={9} title="Supportband / Slot / Position">
        <p>
          {dealMemo.performanceTime && (
            <>
              <span className="font-semibold">Showtime:</span> {dealMemo.performanceTime}
              <br />
            </>
          )}
          {dealMemo.performanceDuration && (
            <>
              <span className="font-semibold">Spielzeit:</span> {dealMemo.performanceDuration}
              <br />
            </>
          )}
          {dealMemo.performanceInformation}
        </p>
      </Section>

      {/* 10. Sponsoring */}
      <Section number={10} title="Vereinigungen, Sponsoring, Präsentation">
        <p>{BOILERPLATE.sponsorship}</p>
      </Section>

      {/* 11. Organisation und Sicherheit */}
      <Section number={11} title="Organisation und Sicherheit">
        <p>{BOILERPLATE.organization}</p>
        <p>{BOILERPLATE.security}</p>
      </Section>

      {/* 12. Werbung */}
      <Section number={12} title="Werbung">
        <p>{BOILERPLATE.advertising}</p>
      </Section>

      {/* 13. Konzertausfall */}
      <Section number={13} title="Konzertausfall / Vertragsstrafe / pauschalierter Schadensersatz">
        <SubSection number="13.1" title="">
          <p>{BOILERPLATE.cancellation(formatMoney(guarantee ?? 4000))}</p>
        </SubSection>
        <SubSection number="13.2" title="">
          <p>{BOILERPLATE.forceMajeure}</p>
        </SubSection>
        <SubSection number="13.3" title="">
          <p>{BOILERPLATE.insurance}</p>
        </SubSection>
        <SubSection number="13.4" title="">
          <p>{BOILERPLATE.resale}</p>
        </SubSection>
      </Section>

      {/* 14. Merchandising */}
      <Section number={14} title="Merchandising">
        <p>{BOILERPLATE.merch}</p>
      </Section>

      {/* 15. Aufnahmen */}
      <Section number={15} title="Film-, Video- und Tonaufnahmen sowie -übertragungen">
        <p>{BOILERPLATE.recordings}</p>
      </Section>

      {/* 16. Gästeliste */}
      <Section number={16} title="Gästeliste - Freikarten - Backstageausweise">
        <p>{BOILERPLATE.guestList}</p>
      </Section>

      {/* 17. Rechtsverhältnis */}
      <Section number={17} title="Rechtsverhältnis">
        <p>{BOILERPLATE.legalRelation}</p>
      </Section>

      {/* 18. Konzertvorbereitung */}
      <Section number={18} title="Konzertvorbereitung">
        <p>{BOILERPLATE.preparation}</p>
      </Section>

      {/* 19. Allgemeines */}
      <Section number={19} title="Allgemeines">
        <p>{BOILERPLATE.general}</p>
      </Section>

      {/* Special clauses */}
      {dealMemo.contractNotes && (
        <Section number={20} title="Sondervereinbarungen">
          <p className="whitespace-pre-wrap">{dealMemo.contractNotes}</p>
        </Section>
      )}

      {/* Signatures */}
      <div className="mt-12 grid grid-cols-2 gap-16 text-[10pt]">
        <div>
          {artistImageUrl && (
            <img src={artistImageUrl} alt="" className="mb-1 max-h-[15mm] object-contain" />
          )}
          <div className="border-t border-black pt-1">Ort, Datum, Unterschrift Künstler</div>
        </div>
        <div>
          <div className="border-t border-black pt-1">
            Ort, Datum, Unterschrift örtlicher Veranstalter
          </div>
        </div>
      </div>
    </div>
  )
}
