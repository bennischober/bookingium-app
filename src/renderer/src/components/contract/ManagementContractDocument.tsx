import type { ContractParty } from '../../../../main/api/schemas/contract.schema'
import type { ManagementContractPrintData } from '../../../../main/api/schemas/management_contract.schema'
import { PagedDocument } from '../print/PagedDocument'
import { germanNumberWord, germanQuantity } from '@/lib/germanNumbers'

// ========================================
// Helpers
// ========================================

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)} %`
}

/** "dreißig (30)" */
function numberWithWord(n: number): string {
  return `${germanNumberWord(n)} (${n})`
}

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
      <h3 className="mb-1 text-[11pt] font-bold">
        § {number} {title}
      </h3>
      <div className="space-y-2 text-[10pt] leading-relaxed text-justify">{children}</div>
    </div>
  )
}

function PartyBlock({ party, fallback }: { party: ContractParty | null; fallback: string }) {
  if (!party) return <div className="font-bold">{fallback}</div>
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
// Management contract (wording from the agency's contract draft; the
// variable terms come from the contract record)
// ========================================

export function ManagementContractDocument({
  data,
  letterheadUrl,
  managementSignatureUrl
}: {
  data: ManagementContractPrintData
  letterheadUrl?: string
  managementSignatureUrl?: string
}) {
  const { contract: c, band, management, artist, members, representative } = data
  const artistName = band.name

  return (
    <PagedDocument>
      {letterheadUrl && (
        <img
          src={letterheadUrl}
          alt=""
          className="mb-4 ml-auto max-h-[20mm] max-w-[60mm] object-contain"
        />
      )}

      <h1 className="mb-6 text-center text-[16pt] font-bold tracking-wide">MANAGEMENTVERTRAG</h1>

      {/* Parties */}
      <div className="mb-8 space-y-3 text-center text-[10pt]">
        <p>zwischen</p>
        <PartyBlock party={management} fallback="(Management nicht gewählt)" />
        <p>– nachstehend MANAGEMENT genannt –</p>
        <p>und</p>
        <PartyBlock party={artist} fallback={artistName} />
        <p>– nachstehend einzeln und gemeinsam „KÜNSTLER“ genannt –</p>
      </div>

      <Section number={1} title="Vertragsgegenstand">
        <p>
          Der KÜNSTLER ist in der Unterhaltungsindustrie vorrangig als Musiker, Komponist und
          Textdichter tätig (nachstehend „Karriere“ genannt). KÜNSTLER wird u.a. allein oder mit
          anderen zusammen Ton- bzw. Bildaufnahmen erstellen und auch Werke durch öffentliche
          Vorführung und Aufführung, sei es durch Live-Auftritte allein oder im Rahmen einer Tournee
          oder im Rundfunk und Fernsehen oder sonstigen Medien vortragen und auswerten.
        </p>
        <p>
          Gegenstand dieses Vertrages ist die Unterstützung von {artistName} bei dem Aufbau und der
          Förderung seiner Karriere. In diesem Zusammenhang berät MANAGEMENT den KÜNSTLER exklusiv
          in allen künstlerischen, organisatorischen und wirtschaftlichen Belangen.
        </p>
        <p>
          Kein Gegenstand dieses Vertrages ist eine Vermittlung von KÜNSTLER in eine abhängige
          Beschäftigung als Arbeitnehmer bzw. die Vermittlung einer Arbeitsstelle. Insoweit ist auch
          weder das „Arbeitsvermittlungsgesetz“ noch die „Arbeitsvermittlungsverordnung“ auf diesen
          Vertrag anwendbar.
        </p>
      </Section>

      <Section number={2} title="Vertragsgebiet">
        <p>
          Der KÜNSTLER verpflichtet das MANAGEMENT, die vertragsgegenständlichen Aufgaben{' '}
          {c.territory} wahrzunehmen.
        </p>
      </Section>

      <Section number={3} title="Vertragsdauer">
        <p>
          Die Vertragsdauer beginnt mit Datum der Letztunterschrift unter diesen Vertrag und hat
          eine Laufzeit von {germanQuantity(c.termYears, 'einem (1) Jahr', 'Jahren')}. Die
          Vertragsdauer verlängert sich automatisch um jeweils{' '}
          {germanQuantity(c.renewalYears, 'ein (1) weiteres Jahr', 'weitere Jahre')}, wenn der
          Vertrag nicht jeweils {germanQuantity(c.noticeMonths, 'einen (1) Monat', 'Monate')} vor
          Beendigung der jeweils laufenden Vertragsperiode schriftlich gekündigt wird.
        </p>
        <p>Das gesetzliche Recht zur fristlosen Kündigung aus wichtigem Grund bleibt unberührt.</p>
        <p>
          Kündigungen sind nur wirksam, wenn sie der anderen Partei per Einwurfeinschreiben
          zugestellt worden sind.
        </p>
      </Section>

      <Section number={4} title="Grundsätze der Zusammenarbeit">
        <p>
          Die Parteien sind sich darüber einig, dass nur eine enge und vertrauensvolle
          Zusammenarbeit für die Karriere von KÜNSTLER förderlich ist. Daher werden die Grundsätze
          der Zusammenarbeit, der Öffentlichkeitsarbeit und aller damit in Verbindung stehender
          Maßnahmen zwischen den Parteien einvernehmlich abgestimmt.
        </p>
        <p>
          Die Parteien werden sich bemühen, regelmäßig zu einer Besprechung zusammenzufinden oder
          fernmündlich zu kommunizieren. MANAGEMENT wird KÜNSTLER regelmäßig – mindestens einmal pro
          Monat – über die jeweiligen Planungen und Aktivitäten des MANAGEMENTs im Rahmen eines sog.
          „Fortschrittsberichtes“ per E-Mail informieren.
        </p>
      </Section>

      <Section number={5} title="Leistungen von MANAGEMENT">
        <p>
          Der KÜNSTLER beauftragt das MANAGEMENT während der Vertragsdauer im Vertragsgebiet
          exklusiv mit der Wahrnehmung seiner künstlerischen, medialen und wirtschaftlichen
          Interessen auf allen Gebieten seiner künstlerischen Tätigkeit sowie der Übernahme der
          organisatorischen Belange im Rahmen der Karriere von KÜNSTLER. Das MANAGEMENT wird sich in
          enger Absprache mit KÜNSTLER insbesondere um folgende Aufgaben kümmern:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>die Entwicklung, Konzeption, Planung und Förderung der Karriere von KÜNSTLER;</li>
          <li>
            die Wahrung der künstlerischen, medialen und kommerziellen Interessen von KÜNSTLER
            gegenüber Dritten (z.B. Verlage, Ton-/Bildtonträgerhersteller, Booking-Agenturen);
          </li>
          <li>
            Beratung von KÜNSTLER bei dessen künstlerischen Tätigkeiten (z.B. bei Ton- und/oder
            Video-Produktionen, insbesondere Auswahl von Produzenten, Konzert- bzw.
            Tourneeveranstaltungen, Bühnenperformance, Cover-Gestaltung, Internet-Präsenz) sowie
            dessen Styling und Image;
          </li>
          <li>
            ergänzende Beratung von KÜNSTLER bei sämtlichen die Karriere von KÜNSTLER betreffenden
            Vertragsabschlüssen (z.B. Verlags-, Ton-/Bildtonträger-, Tournee- oder sonstige
            Verwertungsverträge) sowie Verhandlung der wirtschaftlichen Konditionen dieser Verträge.
            MANAGEMENT ist nach vorheriger schriftlicher Zustimmung von KÜNSTLER auch berechtigt,
            diese Verhandlungen einem Dritten, z.B. einem Rechtsanwalt, auf Kosten von KÜNSTLER zu
            übertragen, insbesondere wenn es sich um Rechtsberatung handelt;
          </li>
          <li>
            die Organisation, Koordination und sonstige Vorbereitung von Promotion- und
            Marketingmaßnahmen, z.B. Interviews mit Fernseh-/Radiosendern bzw. -produzenten sowie
            mit Printmedien, die der Imagepflege von KÜNSTLER und der Popularisierung seines Namens
            dienen, in Ergänzung zu den entsprechenden Maßnahmen Dritter;
          </li>
          <li>
            ergänzende Beratung bei der Überprüfung von Lizenzabrechnungen von KÜNSTLER. MANAGEMENT
            ist nach vorheriger schriftlicher Zustimmung von KÜNSTLER auch berechtigt, diese
            Überprüfungen einem Dritten, z.B. einem Wirtschaftsprüfer, auf Kosten von KÜNSTLER zu
            übertragen.
          </li>
        </ul>
        <p>
          Das MANAGEMENT wird sich des Weiteren in jeder gebotenen Weise einsetzen, um den KÜNSTLER
          zu fördern sowie das Image von KÜNSTLER zu pflegen. Dabei wird das MANAGEMENT durch seine
          Aktivitäten insbesondere bestehende Kontakte zu Auswertungspartnern und sonstigen
          Geschäftspartnern (z.B. Produzenten, Ton-/Bildtonträgerhersteller, Vertrieben, Verlagen,
          Konzertagenturen, Veranstaltern, Presse, Funk und Fernsehen, Internet-Plattformen sowie
          Gamesproduzenten, Werbeagenturen und sonstigen Industriefirmen, die z.B. im Bereich der
          Medienauswertung tätig sind) vertiefen und zum Wohle von KÜNSTLER bzw. der Leistungen und
          Werke von KÜNSTLER nutzen.
        </p>
        <p>
          Das MANAGEMENT verpflichtet sich, über alle vertragsgegenständlichen Geschäfte
          detaillierte Unterlagen zu führen und dem KÜNSTLER auf Anforderung während seiner üblichen
          Bürostunden Einsicht in diese Unterlagen zu gewähren.
        </p>
        <p>
          Das MANAGEMENT kann vertragsgegenständliche Aufgaben und Leistungen auf Dritte delegieren,
          sofern dem KÜNSTLER hierdurch keine zusätzlichen Kosten entstehen oder zusätzliche Kosten
          einvernehmlich vereinbart wurden.
        </p>
      </Section>

      <Section number={6} title="Bevollmächtigung von MANAGEMENT">
        <p>
          KÜNSTLER erteilt MANAGEMENT unbeschränkte Verhandlungsvollmacht im Zusammenhang mit den
          vertragsgegenständlichen Aufgaben von MANAGEMENT. MANAGEMENT ist jedoch weder berechtigt
          noch bevollmächtigt, Verträge mit bindender Wirkung für den KÜNSTLER abzuschließen, es sei
          denn, der KÜNSTLER erteilt MANAGEMENT hierzu im Einzelfall eine Abschlussvollmacht. Diese
          Abschlussvollmacht kann schriftlich oder auch per E-Mail erteilt werden.
        </p>
      </Section>

      <Section number={7} title="Exklusivität">
        <p>
          Die Exklusivität erstreckt sich im Vertragsgebiet und während der Vertragslaufzeit auf die
          Person von KÜNSTLER in seiner Eigenschaft als Künstler und damit auch auf sämtliche
          Künstlernamen bzw. Alter Egos, unter denen KÜNSTLER künstlerisch tätig ist und auftritt.
          Ist KÜNSTLER eine Gesellschaft, erstreckt sich die Exklusivität auch auf jeden einzelnen
          Gesellschafter entsprechend und die von ihm während der Vertragslaufzeit genutzten Alter
          Egos und Künstlernamen.
        </p>
        <p>
          Der KÜNSTLER ernennt das MANAGEMENT für die Vertragsdauer zu seinem exklusiven und
          einzigen MANAGEMENT. Das MANAGEMENT wird insoweit exklusiv berechtigt, die
          vertragsgegenständlichen Aufgaben wahrzunehmen und insoweit gegenüber Dritten als
          exklusives MANAGEMENT von KÜNSTLER aufzutreten.
        </p>
        <p>
          Das MANAGEMENT ist jedoch nicht verpflichtet, ausschließlich dem KÜNSTLER zur Verfügung zu
          stehen. Vielmehr ist das MANAGEMENT auch berechtigt, Dritte zu managen, auch wenn es sich
          bei solchen Dritten um Personen handelt, die ggf. mit dem KÜNSTLER im Wettbewerb stehen.
          Das MANAGEMENT ist berechtigt, einzelne oder sämtliche Aktivitäten im Rahmen der
          Managementtätigkeit auf verschiedene Mitarbeiter von MANAGEMENT oder auch auf Dritte zu
          delegieren bzw. zu übertragen; dies muss in Absprache mit dem KÜNSTLER stattfinden.
        </p>
      </Section>

      <Section number={8} title="Vergütung von MANAGEMENT">
        <p>
          Für die Erbringung seiner vertragsgegenständlichen Leistungen erhält MANAGEMENT eine
          Vergütung in Höhe von <strong>{formatPercent(c.commissionPercent)}</strong> (zzgl. der
          gesetzlichen USt.) sämtlicher Nettoeinnahmen von KÜNSTLER, die dieser im Rahmen seiner
          künstlerischen Tätigkeit und/oder aus der Verwertung der musikalischen Werke, die der
          KÜNSTLER als Komponist und/oder Texter geschaffen und/oder bearbeitet hat, vereinnahmt
          (z.B. Einnahmen aus Tonträger- und sonstigen Auswertungen von Tonaufnahmen des KÜNSTLERs,
          Live-Gagen sowie Erlöse aus sonstigen Auftritten, Merchandisingerlöse, Einkünfte aus Film,
          Fernsehen, Rundfunk und Theater sowie Erlöse aus Testimonial-, Werbe- oder sonstigen
          Auswertungsverträgen, deren Gegenstand die Verwertung von Leistungsschutzrechten, Namen,
          Ruf bzw. Bild von KÜNSTLER darstellt).
          {c.excludedIncome.trim() && ` ${c.excludedIncome.trim()} sind hiervon ausgeschlossen.`}
        </p>
        <p>Nettoeinnahmen werden wie folgt definiert:</p>
        <p>
          Bruttoeinkünfte, die dem KÜNSTLER als Gegenleistung im Rahmen seiner künstlerischen
          Tätigkeit zufließen oder gutgeschrieben werden (nicht jedoch reine Auslagen- oder
          Kostenerstattungen), abzüglich:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>der gesetzlichen Umsatz- und/oder anderer Verkaufssteuer(n) sowie</li>
          <li>
            sämtlicher – im Vorwege mit MANAGEMENT schriftlich vereinbarter – von dem KÜNSTLER zu
            übernehmenden Produktionskosten und Drittbeteiligungen (z.B. Beteiligungen von sog.
            Miet-Musikern, Booking-Agenturen).
          </li>
        </ul>
        <p>
          Ansonsten ist es für die Ermittlung der Nettoeinnahmen als Berechnungsgrundlage der
          Vergütung von MANAGEMENT unerheblich, welche Kosten oder Drittbeteiligungen der KÜNSTLER
          zu tragen hat.
        </p>
        <p>
          Zu den Nettoeinnahmen gehören sämtliche Vergütungen, die der KÜNSTLER erhält, gleichgültig
          in welcher Form und mit welcher Bezeichnung diese gezahlt werden (z.B. Gehälter,
          Bonusvergütungen, Umsatz- bzw. Gewinnbeteiligungen, Vorschuss- bzw. Garantiezahlungen,
          Naturalleistungen, Gesellschafts- oder sonstige Anteile an Unternehmen bzw. Unternehmungen
          oder sonstige geldwerte Leistungen). Dies betrifft nur die Einnahmen, die unter dem Namen{' '}
          {artistName} generiert werden.
        </p>
        <p>
          Für die Beteiligung von MANAGEMENT ist es unerheblich, ob ein Vertrag oder die Einnahmen
          von KÜNSTLER mit oder ohne direktes Hinzutun von MANAGEMENT zustande gekommen sind. Der
          Vergütungsanspruch von MANAGEMENT steht dem MANAGEMENT für sämtliche Verwertungshandlungen
          während der Vertragsdauer sowie unter den Voraussetzungen des § 13 während der
          nachvertraglichen Vergütungsdauer zu.
        </p>
      </Section>

      <Section number={9} title="Abrechnungsmodalitäten">
        <p>
          Die Abrechnung der Managementbeteiligung gem. § 8 und § 13 erfolgt durch den KÜNSTLER
          vierteljährlich innerhalb von {numberWithWord(c.settlementDays)} Tagen nach Ende des
          Quartals, in dem die jeweiligen Einnahmen bei KÜNSTLER eingegangen sind. Der KÜNSTLER wird
          hierbei – auf Anforderung von MANAGEMENT – dem MANAGEMENT die der Abrechnung zugrunde
          liegenden Belege vorlegen. Abrechnungen werden per E-Mail übermittelt, bis auf Weiteres an
          folgende E-Mail-Adresse: <strong>{c.statementEmail || '________________'}</strong>
        </p>
        <p>
          Abrechnungen gelten als genehmigt, wenn MANAGEMENT nicht innerhalb eines Monats nach
          Zugang unter Angabe von Gründen widerspricht.
        </p>
        <p>Die Zahlungen erfolgen mit befreiender Wirkung auf das folgende Konto:</p>
        <div className="break-inside-avoid pl-5 font-semibold leading-snug">
          <div>{management?.accountHolder || management?.name || '________________'}</div>
          <div>{management?.bankName || 'Bank: ________________'}</div>
          <div>IBAN: {management?.iban || '________________'}</div>
          <div>BIC: {management?.bic || '________________'}</div>
        </div>
        <p>
          Die Auszahlung an das MANAGEMENT erfolgt innerhalb von {numberWithWord(c.paymentDays)}{' '}
          Tagen nach Eingang einer ordnungsgemäßen Rechnung beim KÜNSTLER.
        </p>
        <p>
          Der KÜNSTLER verpflichtet sich, sämtliche Zahlungsansprüche, die aufgrund von Verträgen
          mit Dritten entstehen, diesen Dritten gegenüber geltend zu machen und erforderlichenfalls
          alle notwendigen Schritte zum Inkasso von Beträgen einzuleiten, die von Dritten nicht
          fristgemäß bezahlt werden.
        </p>
      </Section>

      <Section number={10} title="Verpflichtungen von KÜNSTLER und Garantie">
        <p>
          KÜNSTLER verpflichtet sich, sämtliche Anfragen Dritter, die im Rahmen seiner
          künstlerischen Tätigkeit an ihn herangetragen werden, an MANAGEMENT weiterzuleiten und
          auch nicht für sich selbst zu verhandeln.
        </p>
        <p>
          KÜNSTLER wird das MANAGEMENT über Ortsabwesenheiten, Urlaub etc. rechtzeitig in Kenntnis
          setzen. Urlaubsbedingte Abwesenheiten von mehr als 10 Tagen wird der KÜNSTLER mindestens
          zwei (2) Monate vor Urlaubsbeginn dem MANAGEMENT mitteilen.
        </p>
        <p>
          KÜNSTLER gewährleistet in diesem Zusammenhang, für sämtliche Aktivitäten
          vertragsgegenständlicher Art (wie öffentliche Auftritte, Werbeaktivitäten und Ton-
          und/oder Bildtonträgerproduktionen) zur Verfügung zu stehen, soweit diese Aktivitäten im
          Einklang mit den künstlerischen und kommerziellen Interessen von KÜNSTLER stehen und somit
          dem Wohle von KÜNSTLER nutzen. Jedoch wird der KÜNSTLER nach eigenem Ermessen entscheiden,
          welche künstlerischen Aktivitäten er durchführen wird.
        </p>
        <p>
          KÜNSTLER garantiert, dass keine vertraglichen Bindungen bestehen, die dem vorliegenden
          Vertragsverhältnis entgegenstehen. Der KÜNSTLER stellt das MANAGEMENT insoweit auf erstes
          Anfordern unbeschränkt von allen berechtigten Ansprüchen Dritter frei und ersetzt dem
          MANAGEMENT alle insoweit entstehenden Schäden und Aufwendungen unter Einschluss etwaiger
          Rechtsverfolgungs- bzw. Rechtsverteidigungskosten.
        </p>
      </Section>

      <Section number={11} title="Werbung">
        <p>
          MANAGEMENT darf mit dem Namen und genehmigten Bildnissen von KÜNSTLER und/oder der
          Tatsache, dass MANAGEMENT das exklusive MANAGEMENT von KÜNSTLER ist, für sich werben.
        </p>
      </Section>

      <Section number={12} title="Steuern">
        <p>
          KÜNSTLER versteuert die ihm aus diesem Vertrag zufließenden Vergütungen selbst. MANAGEMENT
          wird jedoch nach vorheriger schriftlicher Zustimmung von KÜNSTLER im Einzelfall für die
          entsprechenden Arbeiten einen Steuerberater im Namen und auf Kosten von KÜNSTLER
          beauftragen.
        </p>
      </Section>

      <Section number={13} title="Nachvertragliche Vergütung">
        <p>
          Der Beteiligungsanspruch gemäß § 8 steht dem MANAGEMENT während der gesamten Vertragsdauer
          zu. Nach Vertragsbeendigung (und zwar unabhängig von dem jeweiligen Grund) reduziert sich
          die Beteiligung des MANAGEMENTs jedoch wie folgt:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            im 1. Jahr nach Vertragsende auf {formatPercent(c.postTermYear1Percent)} der
            Beteiligung;
          </li>
          <li>
            im 2. Jahr nach Vertragsende auf {formatPercent(c.postTermYear2Percent)} der
            Beteiligung;
          </li>
          <li>
            im 3. Jahr nach Vertragsende auf {formatPercent(c.postTermYear3Percent)} der
            Beteiligung.
          </li>
        </ul>
        <p>
          Dabei ist zwischen den Vertragsparteien vereinbart, dass der Beteiligungsanspruch dem
          MANAGEMENT nur für Einnahmen aus nachfolgenden Verträgen bzw. Vereinbarungen zusteht:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            sämtliche Verträge, die während der Vertragsdauer abgeschlossen bzw. während der
            Vertragsdauer in ihren wesentlichen Punkten verhandelt wurden;
          </li>
          <li>
            sämtliche Erneuerungen, Verlängerungen (insbesondere durch die Ausübung von
            Optionsrechten) und Veränderungen vorgenannter Verträge, auch durch Anschlussverträge.
          </li>
        </ul>
      </Section>

      <Section number={14} title="Reisekosten, Spesen, Auslagen, Bürokosten">
        <p>
          Ein über die Beteiligung gem. § 8 hinausgehender Anspruch von MANAGEMENT besteht –
          vorbehaltlich der vorherigen Zustimmung von KÜNSTLER – nur hinsichtlich der nachfolgenden
          Aufwendungen:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Reisen und damit zusammenhängende Auslagen (wie bspw. Übernachtungskosten und Spesen),
            die MANAGEMENT für den KÜNSTLER durchführt;
          </li>
          <li>
            besonders in Auftrag gegebene sonstige Auslagen und Leistungen (z.B. Kurierdienste).
          </li>
        </ul>
        <p>
          Diese Aufwendungen sind von dem MANAGEMENT nachzuweisen und können von dem MANAGEMENT an
          KÜNSTLER weiterberechnet werden. KÜNSTLER hat diese Aufwendungen innerhalb von dreißig
          (30) Tagen nach schriftlicher Aufforderung zu erstatten.
        </p>
        <p>
          Etwaige Büro- und Telefonkosten, welche dem MANAGEMENT aufgrund seiner Tätigkeit
          entstehen, gehen zu Lasten des MANAGEMENTs und können nicht an den KÜNSTLER
          weiterberechnet werden.
        </p>
      </Section>

      <Section number={15} title="Gruppenklausel">
        <p>
          KÜNSTLER im Sinne dieses Vertrages ist die Gruppe/BGB-Gesellschaft mit dem Namen „
          {artistName}“. Diese besteht aus folgenden Mitgliedern/Gesellschaftern:
        </p>
        {members.length > 0 ? (
          <ul className="break-inside-avoid list-disc space-y-0.5 pl-5 font-semibold">
            {members.map((member) => (
              <li key={member.personId}>{member.name}</li>
            ))}
          </ul>
        ) : (
          <p className="pl-5">________________</p>
        )}
        <p>
          Auftraggeber des MANAGEMENTs ist sowohl die vorgenannte BGB-Gesellschaft als auch jeder
          Gesellschafter dieser BGB-Gesellschaft als Einzelkünstler persönlich. Die exklusive
          Bindung dieses Vertrages erstreckt sich somit auf jedes Mitglied der Gruppe. Jegliches
          Hinzutreten bzw. Ausscheiden von Einzelkünstlern aus der Gruppe ist dem MANAGEMENT
          unverzüglich mitzuteilen. Gruppe als auch Einzelkünstler sind verpflichtet, bei Eintritt
          weiterer Einzelkünstler in die Gruppe diese dazu zu verpflichten, in sämtliche Rechte und
          Pflichten dieses Managementvertrags mit einzutreten.
        </p>
        <p>
          Die einzelnen Mitglieder von KÜNSTLER (bzw. die einzelnen Gesellschafter der
          BGB-Gesellschaft) bevollmächtigen hiermit ausdrücklich ihr Mitglied (bzw. den
          Gesellschafter){' '}
          <strong>
            {representative
              ? [
                  representative.name,
                  [representative.street, representative.streetNumber].filter(Boolean).join(' '),
                  [representative.zipCode, representative.city].filter(Boolean).join(' ')
                ]
                  .filter(Boolean)
                  .join(', ')
              : '________________'}
          </strong>
          , sie beim Empfang von Willenserklärungen, Abrechnungen, Zahlungen etc. aus diesem Vertrag
          zu vertreten. Änderungen der Adressdaten sowie Erteilung und Entzug von Vollmachten werden
          erst verbindlich, nachdem sie MANAGEMENT in schriftlicher Form zugegangen sind.
        </p>
      </Section>

      <Section number={16} title="Schlussbestimmungen">
        <p>
          Die Parteien verpflichten sich hinsichtlich des Inhaltes dieses Vertrages und aller damit
          in Zusammenhang stehenden Informationen zur Verschwiegenheit. MANAGEMENT verpflichtet sich
          darüber hinaus, über die wirtschaftlichen und persönlichen Verhältnisse und Vorgänge den
          KÜNSTLER betreffend, welche MANAGEMENT im Rahmen dieses Vertrages erlangt, gegenüber
          Dritten Stillschweigen zu bewahren. Vorstehende Verpflichtungen zur Verschwiegenheit
          binden beide Partner bis 10 Jahre nach Vertragsende.
        </p>
        <p>
          Mündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen dieses Vertrages
          bedürfen der Schriftform. Dies gilt auch für die Abbedingung des
          Schriftformerfordernisses. Soweit in diesem Vertrag im Einzelfall nichts Besonderes
          geregelt ist, verstehen die Parteien unter Schriftform in diesem Vertrag die Textform im
          Sinne des § 126b BGB (z.B. E-Mail, Fax).
        </p>
        <p>Der Vertrag unterliegt dem Recht der Bundesrepublik Deutschland.</p>
        <p>
          Ausschließlicher Erfüllungsort sowie ausschließlicher Gerichtsstand ist der jeweilige
          Geschäftssitz von MANAGEMENT.
        </p>
        <p>
          Das MANAGEMENT ist berechtigt, diesen Vertrag insgesamt oder Teile dieses Vertrages für
          interne Firmenumstrukturierungen zu übertragen, nicht jedoch an Fremdunternehmen zu
          veräußern.
        </p>
        <p>
          Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, so berührt dies die
          Gültigkeit des Vertrages im Übrigen nicht. Vorstehende Regelung gilt entsprechend auch bei
          Vertragslücken.
        </p>
      </Section>

      {c.specialClauses.trim() && (
        <Section number={17} title="Sondervereinbarungen">
          <p className="whitespace-pre-wrap">{c.specialClauses}</p>
        </Section>
      )}

      {/* Signatures: each side's place with a blank date - the parties
          usually sign on different days. Never split, never alone on a page. */}
      <div className="mt-12 flex break-before-avoid break-inside-avoid text-[10pt]">
        <div className="w-1/2 pr-8">
          <div>{management?.city || '____________'}, den ____________</div>
          {/* Same fixed signature area on both sides keeps the lines level */}
          <div className="mt-2 flex h-[15mm] items-end">
            {managementSignatureUrl && (
              <img src={managementSignatureUrl} alt="" className="max-h-full object-contain" />
            )}
          </div>
          <div className="mt-2 w-4/5 border-t-2 border-black pt-1">
            MANAGEMENT
            {management && <div>{management.name}</div>}
          </div>
        </div>
        <div className="w-1/2 pr-8">
          <div>{artist?.city || '____________'}, den ____________</div>
          <div className="mt-2 h-[15mm]" />
          <div className="mt-2 w-4/5 border-t-2 border-black pt-1">
            KÜNSTLER
            <div>{artist?.name ?? artistName}</div>
          </div>
        </div>
      </div>
    </PagedDocument>
  )
}
