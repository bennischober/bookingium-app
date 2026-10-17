import type { ContractData, ContractParty } from '../../../../main/api/schemas/contract.schema'
import { PagedDocument } from '../print/PagedDocument'

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

// ========================================
// Section primitives
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
    <div className="mb-3">
      <h3 className="font-bold text-[12pt] underline mb-1">
        {number}. {title}
      </h3>
      <div className="space-y-2 text-[10pt] leading-relaxed text-justify">{children}</div>
    </div>
  )
}

function AddressLines({ party }: { party: ContractParty }) {
  return (
    <div className="leading-snug">
      <div className="font-bold">{party.name}</div>
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
    </div>
  )
}

// ========================================
// Contract document (structure and wording from the old repo's PDFContract,
// ported to the print-to-PDF renderer)
// ========================================

export const CONTRACT_PADDING_MM = 20

export function ContractDocument({
  data,
  artistImageUrl,
  artistSignatureUrl
}: {
  data: ContractData
  artistImageUrl?: string
  artistSignatureUrl?: string
}) {
  const { dealMemo, band, artist, representative, promoter, technician, venue, hotel } = data

  const today = new Date()
  const todayStr = formatDate(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  )

  const guarantee = dealMemo.guaranteeAmount
  const vatRate = dealMemo.guaranteeVatRate
  const guaranteeVat = guarantee !== null && vatRate !== null ? (guarantee * vatRate) / 100 : null
  const guaranteeGross = guarantee !== null ? guarantee + (guaranteeVat ?? 0) : null

  return (
    <PagedDocument>
      {/* Letterhead: artist company identity */}
      {artistImageUrl && (
        <img
          src={artistImageUrl}
          alt=""
          className="mb-4 ml-auto max-h-[20mm] max-w-[60mm] object-contain"
        />
      )}

      <h1 className="text-center text-[16pt] font-bold underline mb-6 tracking-wide">
        KONZERTVERTRAG
      </h1>

      {/* Party blocks */}
      <div className="text-[10pt] leading-relaxed">
        <p className="font-bold">zwischen Vertragspartner (VP1):</p>
        <div className="mt-2 mb-1">{artist ? <AddressLines party={artist} /> : band?.name}</div>
        <p className="font-bold mt-2">vertreten durch:</p>
        <p className="italic">
          {representative && representative.name !== artist?.name
            ? `${representative.name}, ${representative.street} ${representative.streetNumber}, ${representative.zipCode} ${representative.city}`
            : artist?.representative
              ? artist.representative
              : (artist?.name ?? '-')}
        </p>

        <p className="font-bold mt-4">und Vertragspartner (VP2):</p>
        <div className="mt-2 mb-1">{promoter ? <AddressLines party={promoter} /> : '-'}</div>
        <p className="font-bold mt-2">vertreten durch:</p>
        <p className="italic">
          {promoter?.representative || '-'}
          {promoter?.phone || promoter?.email
            ? `, ${[promoter?.phone, promoter?.email].filter(Boolean).join(', ')}`
            : ''}
        </p>

        <p className="mt-3">
          Künstlersozialkassen-Nummer von „VP2“ (bitte eintragen - falls bekannt):{' '}
          <span className="font-semibold">{promoter?.kskNumber || '_________________'}</span>
        </p>

        <p className="font-bold mt-4">gilt folgendes als vereinbart:</p>
      </div>

      {/* 1. Engagement */}
      <Section number={1} title="Engagement">
        <p className="font-bold">
          Gegenstand dieses Vertrages ist die Durchführung eines Konzertes von örtlichen
          Veranstalter (VP2) mit der Gruppe/Künstler {band?.name ?? '-'} (VP1) am{' '}
          {formatDate(dealMemo.date)} in der Location &apos;{venue?.name ?? '-'}&apos; zu den hier
          aufgeführten Bedingungen:
        </p>
        <p>
          Diese Vereinbarung stellt eine schriftliche Bestätigung der bereits getroffenen
          Vereinbarungen dar und dient dazu, sämtliche den Auftritt des Künstlers (VP1) betreffende
          Fragen im Voraus verbindlich zu klären. VP1 stellt die Tourneeproduktion, Backline,
          Künstlertransport, Tourneepersonal. VP2 als örtlicher Veranstalter trägt sämtliche vor Ort
          anfallenden Kosten und die Kosten der Bühnenanweisung, wie u.a. Hallenmiete inkl.
          Nebenkosten, P.A. &amp; Licht, Hotel, Catering, Werbung, Sicherungs- und Ordnungsdienst,
          Gema, KSK, Versicherungsprämie für den in seinen Bereich fallenden Versicherungsschutz,
          Steuern und Abgaben seines Bereiches. Hierfür trägt er auch die alleinige Haftung und
          stellt VP1 von jeder Haftung frei. Details regeln die Bühnenanweisung von VP1 und weitere
          Punkte in diesem Vertrag. Eine räumliche und zeitliche Exklusivität wurde nicht
          vereinbart.
        </p>
        <p>Es handelt sich um folgendes Programm:</p>
        <p className="font-bold">
          Auftrittszeit: {dealMemo.performanceTime || '-'} Uhr
          <br />
          Spieldauer: {dealMemo.performanceDuration || '-'}
          <br />
          Sonstiges: {dealMemo.performanceInformation || '-'}
        </p>
      </Section>

      {/* 2. Honorar */}
      <Section number={2} title="Honorar / Produktionskosten">
        <p>
          Als Honorar ist vereinbart: VP1 erhält {dealMemo.deal || 'die getroffene Vereinbarung'}.
        </p>
        {guarantee !== null && (
          <p className="font-bold">
            Eine Garantiezahlung in Höhe von {formatMoney(guarantee)}
            {vatRate !== null && vatRate > 0
              ? ` zzgl. ${formatVatRate(vatRate)} % MwSt. (Gesamt: ${formatMoney(guaranteeGross ?? 0)})`
              : ''}{' '}
            ist an VP1 zu zahlen.
          </p>
        )}
      </Section>

      {/* 3. Abrechnung */}
      <Section number={3} title="Abrechnung">
        <p>
          Die Fixgage sowie eine etwaige Eintritts Einnahmenbeteiligung ist im Anschluss nach Erhalt
          der Rechnungen per Banküberweisung auf folgendes Konto zu überweisen.
        </p>
        <p className="font-bold not-italic">
          Kontoinh.: {artist?.accountHolder || artist?.name || '-'}
          <br />
          Bank: {artist?.bankName || '-'}
          <br />
          IBAN: {artist?.iban || '-'}
          <br />
          BIC: {artist?.bic || '-'}
        </p>
        <p>
          Bei einer Eintritts Einnahmenbeteiligung der Künstler (VP1) hat der Vertreter der Künstler
          das Recht, jederzeit Kartensätze, Vorverkauf und Abendkasse, sowie die Auflistung der
          örtlichen Kosten zu überprüfen und zu überwachen. Kosten die nicht vorzuweisen sind,
          werden nicht anerkannt. Sollte der lokale Veranstalter die Eintrittskarten nicht über den
          Tournee-Veranstalter bezogen haben, so sind die Original-Lieferscheine der Druckerei vor
          Einlass dem Tour-Manager vorzulegen. Die Eintrittskarten müssen unbedingt durchnummeriert
          sein!!! Sollten die gedruckten Tickets an Vorverkaufsstellen ausgeliefert worden sein, so
          sind diese mit einem Lieferschein am Veranstaltungstag zu belegen. Nicht retournierte
          Tickets gelten als verkauft.
        </p>
      </Section>

      {/* 4. GEMA/KSK/Steuern */}
      <Section number={4} title="Anmeldungen, GEMA, KSK und Steuern">
        <p>
          VP2 ist verpflichtet die Veranstaltung der GEMA zu melden. Sämtliche aus der Veranstaltung
          anfallenden Steuern, Abgaben und GEMA sind zu 100% von VP2 zu zahlen.
        </p>
        <p>
          Für die Meldung und Abführung der KSK-Beiträge ist der Veranstalter (VP2) verantwortlich.
          Der KSK Beitrag ist nicht Bestandteil des Honorars von VP1.
        </p>
        <p>
          VP2 verpflichtet sich, das Konzert bei den zuständigen Behörden fristgemäß anzumelden und
          alle notwendigen Genehmigungen einzuholen.
        </p>
      </Section>

      {/* 5. Technik/Personal */}
      <Section number={5} title="Technik / Personal">
        <p>
          Der Veranstalter stellt die Ton- und Lichttechnik und das zur Bedienung selbiger nötige
          Fachpersonal laut anliegender Bühnenanweisung (Technikrider). VP2 gewährleistet, dass der
          für die Produktion verantwortliche Techniker spätestens 8-10 Tage vor der Veranstaltung
          den Ansprechpartner von VP1 kontaktiert zum Zwecke der gegenseitigen Absprache.
        </p>
        <p className="font-bold">
          Ansprechpartner VP1: {technician ? `${technician.firstName} ${technician.lastName}` : '-'}
          {technician?.mobilePhone || technician?.email
            ? `, ${[technician?.mobilePhone, technician?.email].filter(Boolean).join(', ')}`
            : ''}
        </p>
        <p>
          VP2 stellt ab Aufbaubeginn für den Backline Auf-und Abbau mindestens zwei nüchterne,
          kräftige und volljährige Helfer, die das Equipment selbständig vom LKW/Sprinter zur Bühne
          und nach Konzertende von der Bühne zum LKW/Sprinter befördern, sowie der Crew für Auf-,
          Um- und Abbauten zur Verfügung stehen.
        </p>
      </Section>

      {/* 6. Bühne */}
      <Section number={6} title="Bühne">
        <p>
          VP2 stellt eine überdachte Bühne entsprechend beiliegender Bühnenanweisung. Die Bühne muss
          stabil, eben und sauber sein und die Spielfläche muss horizontal gerade (!!) ausgerichtet
          sein.
        </p>
      </Section>

      {/* 7. Anreise */}
      <Section number={7} title="Anreise / Zufahrt / Parken">
        <p>
          VP2 schickt spätestens 8 Tage vor VA eine genaue Wegbeschreibung sowie evtl.
          Zufahrtberechtigungsscheine an VP1. VP2 gewährleistet in logistischer Hinsicht, dass VP1
          nach Ankunft jederzeit seine Fahrzeuge beladen und das VA-Gelände verlassen kann. VP2
          stellt VP1 ab Ankunft kostenlos ausreichend Parkmöglichkeiten in unmittelbarer Nähe des
          Auftrittsortes zur Verfügung.
        </p>
      </Section>

      {/* 8. Übernachtung */}
      <Section number={8} title="Übernachtung">
        <p>
          VP2 stellt und trägt die Kosten für Übernachtung mit Frühstück für{' '}
          {dealMemo.amountOfPeople ?? '-'} Personen mit den folgenden Zimmern:{' '}
          {dealMemo.roomInformation || '-'}
          {hotel ? `. Hotel: ${hotel.name}` : ''}.
        </p>
      </Section>

      {/* 9. Catering */}
      <Section number={9} title="Catering">
        <p>
          VP2 stellt Catering für Künstler (VP1) und deren Crew laut anliegender Cateringanweisung,
          bzw. Festival-Catering.
        </p>
      </Section>

      {/* 10. Künstlerische Freiheit */}
      <Section number={10} title="Künstlerische Freiheit">
        <p>
          Die Art der Darbietung und Gestaltung liegt ausschließlich bei dem Künstler (VP1). Der
          Künstler (VP1) ist nur an die durch diesen Vertrag vereinbarten Regelungen gebunden.
        </p>
      </Section>

      {/* 11. Sponsoring */}
      <Section number={11} title="Vereinigungen, Sponsoring, Präsentation">
        <p>
          Handelt es sich bei VP2 um eine Partei, eine Firma, einen Verband, einen eingetragenen
          Verein oder um eine parteienähnliche Organisation etc., so ist dies vor Vertragsabschluss
          ausdrücklich bekanntzugeben. Die Beteiligung jedweder Sponsoren oder Präsentatoren oder
          sonstiger Werbeträger bedarf der schriftlichen Absprache mit der Gruppe. Jegliche
          Werbemittel wie Banner, Plakate, Fahnen und dergleichen im unmittelbaren Bühnenbereich
          sind grundsätzlich nicht gestattet. VP2 gewährleistet zudem, dass VP1 während seines
          Auftrittes in der Bühnenrückwand ein Backdrop mit seinem Bandlogo (4m x 3m) hängen kann.
        </p>
      </Section>

      {/* 12. Organisation und Sicherheit */}
      <Section number={12} title="Organisation und Sicherheit">
        <p>
          VP2 sorgt für einen ungehinderten organisatorischen Ablauf der gesamten Veranstaltung und
          ist verantwortlich für die Sicherheit und die Erfüllung sämtlicher diesbezüglicher
          behördlicher Auflagen. VP2 haftet ab Aufbaubeginn bis Abbauende in voller Höhe für etwaige
          Körper- und Sachschäden (Instrumente, Anlage, KFZ etc.), die durch ihn oder Dritte auf
          Seiten von VP1 entstehen. VP2 stellt ausreichend nüchterne Ordner zur Sicherung des
          Backstage-, Bühnen-, Mischpult- und Eingangsbereichs. Je nach Größe der Veranstaltung ist
          VP2 verpflichtet, den Mischpultplatz sowie die Bühne zusätzlich durch das Aufstellen von
          Absperrgittern zu schützen. VP2 gewährleistet ausserdem ausreichenden, durch sein
          Sicherheitspersonal bewachten bzw. abgesperrten Platz unmittelbar hinter/neben der Bühne
          für den Auf-/Abbau der Instrumente von Künstler. Ab Eintreffen von VP1 am
          Veranstaltungsort stellt VP2 diesem eine durch sein Sicherheitspersonal bewachte bzw.
          abschließbare, beheizbare und beleuchtete Garderobe zur Verfügung, zu der nur VP1 und von
          VP1 bevollmächtigte Personen Zutritt erlangen. Diese muss neben 4 weißen Bühnenhandtüchern
          mit mindestens einem Spiegel ausgestattet sein und darf von außen nicht einsehbar sein.
          VP2 haftet für sämtliche Wertgegenstände von VP1, die sich in dem gesicherten Raum
          befinden. Es wird empfohlen, dass VP2 für die Veranstaltung eine Haftpflichtversicherung
          für Personenschäden und Sachschäden sowie ein Veranstaltungshaftpflicht abschließt. VP2
          stellt Künstler (VP1) von jeder Haftung frei. Die Haftung von Künstler beschränkt sich
          allein auf die durch ihn selbst oder durch die in seinem Auftrag handelnden Personen
          direkt verursachten Schäden im Sinne des § 823 (1) BGB, sofern diese binnen 5 Tagen nach
          dem Konzert VP1 schriftlich mitgeteilt werden.
        </p>
        <p>
          VP2 trägt dafür Sorge, dass keine Waffen oder waffenähnlichen Gegenstände in den
          Veranstaltungsort mitgebracht werden. Bei Störungen kann das Konzert sofort abgebrochen
          werden. Die daraus resultierenden Kosten gehen zu Lasten VP2. Bei Konzertveranstaltungen
          besteht auf Grund der Lautstärke die Gefahr von Hör- und Gesundheitsschäden. Für etwaige
          auftretende Folgenschäden ist VP1 nicht haftbar. VP2 verpflichtet sich, am Eingang vor
          Publikumseinlass bis Veranstaltungsende ein Schild anzubringen, welches Konzertbesucher
          auf diese Gefahren deutlich hinweist.
        </p>
      </Section>

      {/* 13. Werbung */}
      <Section number={13} title="Werbung">
        <p>
          VP2 verpflichtet sich, alle zumutbaren Maßnahmen zu unternehmen, um das Konzert in der
          Öffentlichkeit zu bewerben (Presse, Radio, Plakate, Internet, etc...)
        </p>
        <p>
          Bei Ankündigungen (Plakate, Flyer etc.) sind ausschließlich die Fotos und der
          Originalschriftzug von VP1 zu verwenden, welche VP1 in digitaler Form VP2 zur Verfügung
          stellt. Die Verwendung anderer Fotos oder Schriftzüge bedarf der vorherigen Absprache.
        </p>
        <p className="font-bold">
          Plakate: „VP2“ bestellt(e) folgende Stückzahl an Postern: {dealMemo.posters || '-'}
        </p>
      </Section>

      {/* 14. Konzertausfall */}
      <Section number={14} title="Konzertausfall / Vertragsstrafe / pauschalierter Schadensersatz">
        <p className="font-bold">14.1.</p>
        <p>
          Für jeden einzelnen Fall, dass infolge einer dem Veranstalter (VP2) zurechenbaren
          schuldhaften Handlung oder Unterlassung, insbesondere Vertragsbruch, Rücktritt vom
          Vertrag, oder sonstiger von Veranstalter (VP2) zu vertretender Umstände (z.B. Abbruch des
          Konzerts wegen randalierender Gäste etc.) das vereinbarte Konzert / eines der vereinbarten
          Konzerte oder der Auftritt von Künstler (VP1) nicht oder nur teilweise stattfindet,
          verpflichtet sich Veranstalter (VP2) zur Zahlung einer Vertragsstrafe in Höhe der
          vereinbarten Honorar/Produktionskosten pro ausgefallenem Konzert/Auftritt und leistet
          Schadensersatz für entstandene Aufwendungen wie Nightliner/Hotel und Aufwendung Dritter,
          die von VP1 beauftragt wurden. Die Geltendmachung eines weitergehenden Schadens wird durch
          die vorstehende Schadenspauschalierung nicht ausgeschlossen.
        </p>
        <p className="font-bold">14.2.</p>
        <p>
          Fälle höherer Gewalt einschließlich Krankheit der Künstler (VP1), behördlicher Maßnahmen,
          Streiks, Betriebsstörungen, Ausfall bzw. Verspätung von Verkehrsmitteln und alle sonstigen
          vom Künstler (VP1) nicht zu vertretenden Umstände, die die Gestellung des Künstlers (VP1)
          oder der Technik unmöglich machen oder übermäßig erschweren, entbinden den Künstler (VP1)
          von der Verpflichtung zur Vertragserfüllung. Ansprüche jedweder Art können daraus nicht
          hergeleitet werden. Sollte VP2 die Veranstaltung selbstbestimmend oder auf Grund
          behördlicher Anordnung absagen und VP1 sich bereits auf der Anreise befinden, so
          verpflichtet sich VP2 zur Übernahme sämtlicher Kosten die VP1 durch die An- und Abreise
          entstehen.
        </p>
        <p>
          Benennen die Künstler (VP1) oder Teile des Künstlers für den Konzerttermin eine erst nach
          Vertragsabschluss bekannt gewordene Verpflichtung bei Film, Funk oder Fernsehen, ist VP2
          verpflichtet, die Künstler (VP1) zu genannten Zwecken aus diesem Vertrag zu entlassen. Die
          Künstler sind in diesem Fall verpflichtet, dies dem Veranstalter schnellstmöglich
          anzuzeigen. Beide Parteien tragen ihre bis dahin entstandene und noch entstehende Kosten
          selbst und bemühen sich um einen Ersatztermin.
        </p>
      </Section>

      {/* 15. Merchandising */}
      <Section number={15} title="Merchandising">
        <p>
          VP1 ist berechtigt, vor, während und nach dem Konzert bandeigene Merchandising Artikel zu
          verkaufen (CDs, T-Shirts etc.). VP2 teilt VP1 unmittelbar nach Ankunft den Kontakt zum
          verantwortlichen Merchandise-Verkäufer mit, damit VP1 sich mit ihm in Verbindung setzen
          kann. Sollte es keinen zentralen Verkäufer geben, ist VP2 verpflichtet, für VP1 eine
          Verkaufsfläche mit zwei Tischen (1x Verkaufstisch, 1x Tisch für Rückwand) und einem Stuhl
          zur Verfügung, die VP1 kostenlos nutzen darf. Die Verkaufsfläche muss trocken und gut
          beleuchtet sein sowie über einen 220V Stromanschluss verfügen. Sie sollte sich an einer
          stark frequentierten Stelle befinden und darf nicht mehr als 30 Meter von der Bühne
          entfernt sein.
        </p>
      </Section>

      {/* 16. Aufnahmen */}
      <Section number={16} title="Video- und Tonaufnahmen sowie -Übertragungen">
        <p>
          VP1 ist berechtigt, seinen kompletten Auftritt per Foto, Video- und Audiomitschnitt zu
          dokumentieren. Video- und Tonaufnahmen sowie -Übertragungen durch Dritte sind im Vorfeld
          mit der Gruppe schriftlich zu vereinbaren.
        </p>
      </Section>

      {/* 17. Gästeliste */}
      <Section number={17} title="Gästeliste / Freikarten / Presseakkreditierungen">
        <p>
          Die Gästelistenkapazität wird wie folgt festgelegt und dem Vertreter des Künstlers (VP1)
          mitgeteilt. Sie umfasst aber mindestens 10 (i. W. zehn) Gästelistenplätze. Zusätzlich
          erhält der Künstler (VP1) die Möglichkeit: Fremdveranstalter, Vertreter von Plattenfirmen,
          Medienpartner, Endorsement-Partner u.a. auf die Gästeliste zu setzen (unabhängig von der
          eigentlichen Kapazität).
        </p>
      </Section>

      {/* 18. Bühnenanweisung */}
      <Section number={18} title="Bühnenanweisung">
        <p>
          Die beiliegende Bühnenanweisung inklusive dem Catering-/Technik-Rider und ggf. einer
          Nightliner-Anweisung sind Bestandteil des Vertrages. Die Kosten hieraus trägt VP2.
        </p>
      </Section>

      {/* 19. Rechtsverhältnis */}
      <Section number={19} title="Rechtsverhältnis">
        <p>
          Ein Rechtsverhältnis aus diesem Vertrag kommt nur zwischen der VP1 und dem Veranstalter
          VP2 zustande, nicht jedoch zwischen Veranstalter und {artist?.name || 'die Agentur'}. Die
          Rechtsbeziehungen der Vertragspartner unterliegen deutschem Recht. Jedwede Korrespondenz
          bzgl. dieses Vertrages, wenn nicht anders vereinbart, ist ausschließlich an die Adresse
          von {artist?.name || '-'}, {artist?.street} {artist?.streetNumber} in {artist?.zipCode}{' '}
          {artist?.city} zu richten.
        </p>
      </Section>

      {/* 20. Allgemeines */}
      <Section number={20} title="Allgemeines">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            VP2 versichert, dass er volljährig, geschäftsfähig und berechtigt ist, die Vereinbarung
            zu unterzeichnen.
          </li>
          <li>
            Änderungen, Ergänzungen der Vereinbarung oder Sondervereinbarungen werden nur wirksam,
            wenn sie zwischen den Vertragspartnern schriftlich festgelegt sind. Sollten Teile dieser
            Vereinbarung nichtig sein oder rechtsunwirksam werden, so gilt der Rechtsvertrag weiter.
            Die nichtigen oder rechtsunwirksamen Teile der Vereinbarung sollen dann so ausgelegt
            werden, dass im Ganzen der Sinn der Vereinbarung erhalten bleibt.
          </li>
          <li>
            Sollte der Vertrag nicht innerhalb von 21 Tagen nach Erhalt beim örtlichen Veranstalter
            VP2 unterschrieben an VP1 zurückgeschickt worden sein, so gelten alle von VP1
            aufgeführten Vertragsdetails von VP2 als akzeptiert.
          </li>
          <li>
            Weitere Nebenabsprachen sind nicht getroffen worden. Im Zweifel gelten die bei Konzerten
            üblichen Gepflogenheiten.
          </li>
          <li>
            Beide Vertragspartner verpflichten sich, Stillschweigen gegenüber allen Dritten bzgl.
            des Inhalts dieser Vereinbarung zu wahren.
          </li>
          <li>
            Der unterzeichnete Vertrag einschließlich der unterschriebenen Bühnenanweisung und der
            unterschriebenen Cateringliste als Bestandteile des Vertrages, ein Stadtplan und ein
            Anfahrtsplan sind {artist?.name ?? '-'} bis zwei Wochen nach Erhalt des Vertrages per
            Mail {artist?.email || '-'} oder per Post unterschrieben zurück zu senden.
          </li>
        </ul>
      </Section>

      {/* Special clauses */}
      {dealMemo.contractNotes && (
        <Section number={21} title="Sondervereinbarungen">
          <p className="whitespace-pre-wrap">{dealMemo.contractNotes}</p>
        </Section>
      )}

      {/* Signatures (old layout: place+date line, signature image above the
          line, label below it; both sides structurally identical). Never
          split, and never alone on a page: it stays with the last clause. */}
      <div className="mt-12 flex break-before-avoid break-inside-avoid text-[10pt]">
        <div className="w-1/2 pr-8">
          <div className="w-4/5">
            {representative?.city || artist?.city || 'Bad Hindelang'}, den {todayStr}
          </div>
          {artistSignatureUrl && (
            <img src={artistSignatureUrl} alt="" className="max-h-[15mm] mt-2 object-contain" />
          )}
          <div className="border-t-2 border-black w-4/5 mt-2 pt-1">
            Unterschrift VP1 mit Stempel
          </div>
        </div>
        <div className="w-1/2 pr-8">
          <div className="w-4/5">, den</div>
          <div className="border-t-2 border-black w-4/5 mt-2 pt-1">
            Unterschrift VP2 mit Stempel
          </div>
        </div>
      </div>
    </PagedDocument>
  )
}
