import type { ContractData } from '../../../../main/api/schemas/contract.schema'
import { PagedDocument } from '../print/PagedDocument'
import { AddressLines, Section } from './concertContractParts'
import { contractDeposits, contractSectionNumbers } from './contractSections'

// ========================================
// English concert contract
// ========================================

// Same sections, numbering and data as the German contract (ContractDocument.tsx). The
// wording follows the English booking template the user provided ("Guest Appearance
// Contract") where it has a matching clause, marked "Template:". Clauses without a
// counterpart there are translations of the German contract, marked "Translated:". Both
// are listed in docs/CONTRACT_TRANSLATIONS.md for legal review.

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(value)
}

function formatVatRate(rate: number): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(rate)
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function ContractDocumentEn({
  data,
  letterheadUrl,
  artistSignatureUrl
}: {
  data: ContractData
  letterheadUrl?: string
  artistSignatureUrl?: string
}) {
  const { dealMemo, band, artist, representative, promoter, technician, venue, hotel } = data
  const todayStr = formatDate(localIsoDate(new Date()))

  const guarantee = dealMemo.guaranteeAmount
  const vatRate = dealMemo.guaranteeVatRate
  const guaranteeVat = guarantee !== null && vatRate !== null ? (guarantee * vatRate) / 100 : null
  const guaranteeGross = guarantee !== null ? guarantee + (guaranteeVat ?? 0) : null

  // Optional sections are skipped entirely and the later ones move up a number
  const deposits = contractDeposits(dealMemo)
  const sections = contractSectionNumbers({
    deposits: deposits.length > 0,
    specialAgreements: Boolean(dealMemo.contractNotes)
  })
  const plusVat = vatRate !== null && vatRate > 0 ? ` plus ${formatVatRate(vatRate)}% VAT` : ''

  return (
    <PagedDocument>
      {letterheadUrl && (
        <img
          src={letterheadUrl}
          alt=""
          className="mb-4 ml-auto max-h-[20mm] max-w-[60mm] object-contain"
        />
      )}

      {/* Template: title */}
      <h1 className="text-center text-[16pt] font-bold underline mb-6 tracking-wide">
        GUEST APPEARANCE CONTRACT
      </h1>

      {/* Party blocks */}
      <div className="text-[10pt] leading-relaxed">
        <p className="font-bold">between Contracting Party 1 (CP1):</p>
        <div className="mt-2 mb-1">{artist ? <AddressLines party={artist} /> : band?.name}</div>
        <p className="font-bold mt-2">represented by:</p>
        {representative ? (
          <p className="italic">
            {representative.name}, {representative.street} {representative.streetNumber},{' '}
            {representative.zipCode} {representative.city}
            <br />
            {/* Template: "on behalf and on account of the bands" */}
            (on behalf and on account of {band?.name ?? artist?.name ?? '-'})
          </p>
        ) : (
          <p className="italic">{artist?.representative || artist?.name || '-'}</p>
        )}

        <p className="font-bold mt-4">and Contracting Party 2 (CP2):</p>
        <div className="mt-2 mb-1">{promoter ? <AddressLines party={promoter} /> : '-'}</div>
        <p className="font-bold mt-2">represented by:</p>
        <p className="italic">
          {promoter?.representative || '-'}
          {promoter?.phone || promoter?.email
            ? `, ${[promoter?.phone, promoter?.email].filter(Boolean).join(', ')}`
            : ''}
        </p>

        {/* Translated: KSK number line */}
        <p className="mt-3">
          Künstlersozialkasse (German artists’ social insurance) number of CP2 (please enter if
          known):{' '}
          <span className="font-semibold">{promoter?.kskNumber || '_________________'}</span>
        </p>

        {/* Template: "The above named parties will enter into the following contract" */}
        <p className="font-bold mt-4">The above named parties enter into the following contract:</p>
      </div>

      {/* Translated */}
      <Section number={sections.engagement} title="Engagement">
        <p className="font-bold">
          The subject matter of this contract is a concert by the group/artist {band?.name ?? '-'}{' '}
          (CP1), organised by the local promoter (CP2), on {formatDate(dealMemo.date)} at the venue
          &apos;{venue?.name ?? '-'}&apos; on the terms set out herein:
        </p>
        <p>
          This agreement constitutes a written confirmation of the arrangements already made and
          serves to settle in advance, with binding effect, all questions concerning the appearance
          of the artist (CP1). CP1 provides the tour production, backline, artist transport and
          touring personnel. CP2, as local promoter, bears all costs arising on site and the costs
          of the stage rider, including but not limited to venue rent incl. ancillary costs, PA
          &amp; lights, hotel, catering, advertising, security and stewarding services, GEMA, KSK,
          insurance premiums for the insurance cover falling within its area of responsibility, and
          taxes and duties within its area of responsibility. CP2 is solely liable for these and
          indemnifies CP1 against any liability. Details are governed by CP1’s stage rider and
          further clauses of this contract. No territorial or temporal exclusivity has been agreed.
        </p>
        <p>The programme is as follows:</p>
        <p className="font-bold">
          Show time: {dealMemo.performanceTime || '-'}
          <br />
          Set length: {dealMemo.performanceDuration || '-'}
          <br />
          Other: {dealMemo.performanceInformation || '-'}
        </p>
      </Section>

      {/* Template § 2 (guarantee); the rest translated */}
      <Section number={sections.fee} title="Fee / Production Costs">
        <p>
          The following fee has been agreed: CP1 receives {dealMemo.deal || 'the agreed terms'}.
        </p>
        {guarantee !== null && (
          <p className="font-bold">
            CP2 will pay CP1 a guarantee of {formatMoney(guarantee)}
            {plusVat ? `${plusVat} (total: ${formatMoney(guaranteeGross ?? 0)})` : ''}.
          </p>
        )}
      </Section>

      {/* Translated; "costs that cannot be evidenced" and numbered tickets as in template §§ 2, 7 */}
      <Section number={sections.billing} title="Accounting">
        <p>
          The fixed fee and any share of the door takings are to be paid by bank transfer to the
          following account after receipt of the invoices.
        </p>
        <p className="font-bold not-italic">
          Account holder: {artist?.accountHolder || artist?.name || '-'}
          <br />
          Bank: {artist?.bankName || '-'}
          <br />
          IBAN: {artist?.iban || '-'}
          <br />
          BIC: {artist?.bic || '-'}
        </p>
        <p>
          Where the artist (CP1) has a share of the door takings, the artist’s representative has
          the right to inspect and monitor ticket allocations, advance sales and box office sales as
          well as the list of local costs at any time. Costs that cannot be evidenced will not be
          accepted. If the local promoter has not obtained the tickets via the tour promoter, the
          printer’s original delivery notes must be presented to the tour manager before admission.
          Only numbered tickets are to be sold! If printed tickets have been delivered to advance
          sales outlets, this must be evidenced by a delivery note on the day of the event. Tickets
          not returned are deemed sold.
        </p>
      </Section>

      {/* Translated */}
      {deposits.length > 0 && (
        <Section number={sections.deposits} title="Advance Payment">
          <p>
            CP2 makes the following advance payments on the agreed fee to CP1 (bank details see
            clause {sections.billing}):
          </p>
          <p className="font-bold">
            {deposits.map((deposit, index) => (
              <span key={index}>
                {index > 0 && <br />}
                {deposits.length > 1 ? `Advance payment ${index + 1}` : 'Advance payment'}:{' '}
                {formatMoney(deposit.amount)}
                {plusVat}, due{' '}
                {deposit.dueDate
                  ? `by ${formatDate(deposit.dueDate)}`
                  : 'on conclusion of the contract'}
              </span>
            ))}
          </p>
          <p>
            If an advance payment is not received by CP1 in time, only CP1 is entitled to withdraw
            from the contract. CP1’s claims for damages remain unaffected.
          </p>
        </Section>
      )}

      {/* Translated */}
      <Section number={sections.registration} title="Registrations, GEMA, KSK and Taxes">
        <p>
          CP2 is obliged to register the event with GEMA (German performing rights society). All
          taxes, duties and GEMA fees arising from the event are to be paid in full (100%) by CP2.
        </p>
        <p>
          The promoter (CP2) is responsible for reporting and paying the KSK contributions
          (Künstlersozialkasse, German artists’ social insurance). The KSK contribution is not part
          of CP1’s fee.
        </p>
        <p>
          CP2 undertakes to register the concert with the competent authorities in due time and to
          obtain all necessary permits.
        </p>
      </Section>

      {/* Translated; the helpers' duties as in template § 10 */}
      <Section number={sections.technics} title="Technical Equipment / Personnel">
        <p>
          The promoter provides the sound and lighting equipment and the qualified personnel
          required to operate it in accordance with the attached stage rider (technical rider). CP2
          ensures that the technician responsible for the production contacts CP1’s contact person
          no later than 8–10 days before the event for mutual coordination.
        </p>
        <p className="font-bold">
          Contact person CP1: {technician ? `${technician.firstName} ${technician.lastName}` : '-'}
          {technician?.mobilePhone || technician?.email
            ? `, ${[technician?.mobilePhone, technician?.email].filter(Boolean).join(', ')}`
            : ''}
        </p>
        <p>
          From the start of set-up, CP2 provides at least two sober, strong helpers of legal age to
          transport the equipment (backline) from the truck/van to the stage and, after the concert,
          from the stage back to the truck/van, and to be at the crew’s disposal for setting up,
          changeovers and dismantling.
        </p>
      </Section>

      {/* Template § 11 ("firmly fixed with a level and even surface"); the rest translated */}
      <Section number={sections.stage} title="Stage">
        <p>
          CP2 provides a roofed stage in accordance with the attached stage rider. The stage must be
          firmly fixed, level and clean, and the performance area must have a horizontally even (!!)
          surface.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.travel} title="Arrival / Access / Parking">
        <p>
          No later than 8 days before the event, CP2 sends CP1 exact directions and any access
          permits. CP2 ensures logistically that CP1 can load its vehicles and leave the event site
          at any time after arrival. From arrival, CP2 provides CP1 free of charge with sufficient
          parking in the immediate vicinity of the venue.
        </p>
      </Section>

      {/* Template § 4 ("overnight accommodation"); the rest translated */}
      <Section number={sections.accommodation} title="Accommodation">
        <p>
          CP2 will provide and bear the costs of overnight accommodation with breakfast for{' '}
          {dealMemo.amountOfPeople ?? '-'} persons in the following rooms:{' '}
          {dealMemo.roomInformation || '-'}
          {hotel ? `. Hotel: ${hotel.name}` : ''}.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.catering} title="Catering">
        <p>
          CP2 provides catering for the artist (CP1) and its crew in accordance with the attached
          catering rider, or festival catering.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.artisticFreedom} title="Artistic Freedom">
        <p>
          The type and presentation of the performance are solely at the discretion of the artist
          (CP1). The artist (CP1) is bound only by the provisions agreed in this contract.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.associations} title="Associations, Sponsoring, Presentation">
        <p>
          If CP2 is a political party, a company, an association, a registered society or an
          organisation similar to a political party etc., this must be expressly disclosed before
          the contract is concluded. The involvement of any sponsors, presenters or other
          advertisers requires written agreement with the group. Any advertising material such as
          banners, posters, flags and the like in the immediate stage area is generally not
          permitted. CP2 further ensures that CP1 can hang a backdrop with its band logo (4 m x 3 m)
          on the back wall of the stage during its performance.
        </p>
      </Section>

      {/* Translated; dressing room and barriers as in template §§ 13, 15 */}
      <Section number={sections.security} title="Organisation and Security">
        <p>
          CP2 ensures that the entire event runs without organisational obstruction and is
          responsible for safety and for compliance with all related official requirements. From the
          start of set-up until the end of dismantling, CP2 is liable in full for any personal
          injury and damage to property (instruments, equipment, vehicles etc.) caused to CP1 by CP2
          or by third parties. CP2 provides sufficient sober stewards to secure the backstage,
          stage, mixing desk and entrance areas. Depending on the size of the event, CP2 is obliged
          to additionally protect the mixing desk position and the stage with barriers. CP2 further
          ensures sufficient space directly behind/next to the stage, guarded by its security staff
          or cordoned off, for the artist to set up and dismantle the instruments. From CP1’s
          arrival at the venue, CP2 provides CP1 with a dressing room that is heated, lit and able
          to be locked or guarded by its security staff, to which only CP1 and persons authorised by
          CP1 have access. In addition to 4 white stage towels, it must be equipped with at least
          one mirror and must not be visible from outside. CP2 is liable for all valuables of CP1
          kept in the secured room. It is recommended that CP2 takes out liability insurance for
          personal injury and damage to property as well as event liability insurance for the event.
          CP2 indemnifies the artist (CP1) against any liability. The artist’s liability is limited
          solely to damage caused directly by the artist or by persons acting on its behalf within
          the meaning of § 823 (1) German Civil Code (BGB), provided that such damage is notified to
          CP1 in writing within 5 days after the concert.
        </p>
        <p>
          CP2 ensures that no weapons or weapon-like objects are brought into the venue. In the
          event of disturbances, the concert may be stopped immediately. The resulting costs are
          borne by CP2. At concerts there is a risk of damage to hearing and health due to the
          volume. CP1 is not liable for any consequential damage. CP2 undertakes to put up a sign at
          the entrance, from admission of the audience until the end of the event, clearly drawing
          concert-goers’ attention to these risks.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.advertising} title="Advertising">
        <p>
          CP2 undertakes to take all reasonable measures to promote the concert to the public
          (press, radio, posters, internet, etc.).
        </p>
        <p>
          Announcements (posters, flyers etc.) may only use CP1’s photos and original logo, which
          CP1 provides to CP2 in digital form. The use of other photos or logos requires prior
          agreement.
        </p>
        <p className="font-bold">
          Posters: CP2 orders / has ordered the following number of posters:{' '}
          {dealMemo.posters || '-'}
        </p>
      </Section>

      {/* Translated; "act of God" as in template § 22. "Vertragsstrafe" stays a contractual
          penalty (the template's "liquidated damage" is a different legal concept) */}
      <Section
        number={sections.cancellation}
        title="Cancellation of the Concert / Contractual Penalty / Liquidated Damages"
      >
        <p className="font-bold">{sections.cancellation}.1.</p>
        <p>
          For each individual case in which, as a result of a culpable act or omission attributable
          to the promoter (CP2), in particular breach of contract, withdrawal from the contract or
          other circumstances for which the promoter (CP2) is responsible (e.g. the concert being
          stopped because of rioting guests etc.), the agreed concert / one of the agreed concerts
          or the appearance of the artist (CP1) does not take place or only takes place in part, the
          promoter (CP2) undertakes to pay a contractual penalty in the amount of the agreed
          fee/production costs per cancelled concert/appearance and compensates for expenses
          incurred such as nightliner/hotel and expenses of third parties engaged by CP1. The above
          lump-sum damages do not preclude claiming further damage.
        </p>
        <p className="font-bold">{sections.cancellation}.2.</p>
        <p>
          Acts of God (force majeure), including illness of the artist (CP1), official measures,
          strikes, operational disruptions, failure or delay of means of transport and all other
          circumstances for which the artist (CP1) is not responsible and which make it impossible
          or unreasonably difficult to provide the artist (CP1) or the equipment, release the artist
          (CP1) from the obligation to perform the contract. No claims of any kind can be derived
          from this. If CP2 cancels the event of its own accord or on the basis of an official order
          while CP1 is already travelling to it, CP2 undertakes to bear all costs incurred by CP1
          for the journey there and back.
        </p>
        <p>
          If the artist (CP1) or members of the artist name an engagement in film, radio or
          television for the date of the concert that only became known after the conclusion of the
          contract, CP2 is obliged to release the artist (CP1) from this contract for the said
          purposes. In this case the artist is obliged to notify the promoter as soon as possible.
          Both parties bear their own costs incurred up to then and still to be incurred and will
          endeavour to find an alternative date.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.merchandising} title="Merchandising">
        <p>
          CP1 is entitled to sell the band’s own merchandise (CDs, T-shirts etc.) before, during and
          after the concert. Immediately after arrival, CP2 gives CP1 the contact details of the
          merchandise seller in charge so that CP1 can get in touch with them. If there is no
          central seller, CP2 is obliged to provide CP1 with a sales area with two tables (1 sales
          table, 1 table for the back wall) and one chair, which CP1 may use free of charge. The
          sales area must be dry and well lit and have a 220 V power connection. It should be
          located in a busy spot and must not be more than 30 metres from the stage.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.recordings} title="Video and Audio Recordings and Broadcasts">
        <p>
          CP1 is entitled to document its complete performance by photo, video and audio recording.
          Video and audio recordings and broadcasts by third parties must be agreed in writing with
          the group in advance.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.guestList} title="Guest List / Free Tickets / Press Accreditation">
        <p>
          The guest list capacity is determined as follows and communicated to the representative of
          the artist (CP1). It comprises, however, at least 10 (in words: ten) guest list places. In
          addition, the artist (CP1) may put other promoters, record company representatives, media
          partners, endorsement partners etc. on the guest list (independently of the actual
          capacity).
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.rider} title="Stage Rider">
        <p>
          The attached stage rider including the catering/technical rider and, if applicable, a
          nightliner rider form part of this contract. The costs arising from them are borne by CP2.
        </p>
      </Section>

      {/* Translated */}
      <Section number={sections.legal} title="Legal Relationship">
        <p>
          A legal relationship under this contract is established only between CP1 and the promoter
          CP2
          {representative ? `, but not between the promoter and ${representative.name}.` : '.'} The
          legal relations of the contracting parties are governed by German law. Unless otherwise
          agreed, all correspondence regarding this contract is to be addressed exclusively to{' '}
          {artist?.name || '-'}, {artist?.street} {artist?.streetNumber}, {artist?.zipCode}{' '}
          {artist?.city}.
        </p>
      </Section>

      {/* Translated; changes in writing as in template § 23 */}
      <Section number={sections.general} title="General Provisions">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            CP2 confirms that it is of legal age, has legal capacity and is authorised to sign this
            agreement.
          </li>
          <li>
            Any changes or additions to this agreement and any special agreements are only valid
            with the mutual consent of the contracting parties and must in every case be laid down
            in writing. Should parts of this agreement be void or become legally invalid, the
            remainder of the contract remains in force. The void or invalid parts shall then be
            interpreted in such a way that the overall purpose of the agreement is preserved.
          </li>
          <li>
            If the contract has not been returned signed to CP1 within 21 days of receipt by the
            local promoter CP2, all contract details stated by CP1 are deemed accepted by CP2.
          </li>
          <li>
            No further side agreements have been made. In case of doubt, the customary practices for
            concerts apply.
          </li>
          <li>
            Both contracting parties undertake to keep the content of this agreement confidential
            towards all third parties.
          </li>
          <li>
            The signed contract, including the signed stage rider and the signed catering list as
            parts of the contract, a city map and directions are to be returned signed to{' '}
            {artist?.name ?? '-'} by email ({artist?.email || '-'}) or by post within two weeks of
            receipt of the contract.
          </li>
        </ul>
      </Section>

      {dealMemo.contractNotes && (
        <Section number={sections.specialAgreements} title="Special Agreements">
          <p className="whitespace-pre-wrap">{dealMemo.contractNotes}</p>
        </Section>
      )}

      {/* Signatures: never split, never alone on a page (template: "Signature/Stamp") */}
      <div className="mt-12 flex break-before-avoid break-inside-avoid text-[10pt]">
        <div className="w-1/2 pr-8">
          <div className="w-4/5">
            {representative?.city || artist?.city || '____________'}, {todayStr}
          </div>
          <div className="mt-2 h-[15mm]">
            {artistSignatureUrl && (
              <img src={artistSignatureUrl} alt="" className="max-h-full object-contain" />
            )}
          </div>
          <div className="border-t-2 border-black w-4/5 mt-2 pt-1">
            Contracting Party 1 – Signature/Stamp
            {representative && <div>p.p. {representative.name}</div>}
          </div>
        </div>
        {/* CP2 fills in place, date and signature by hand: nothing is prefilled */}
        <div className="w-1/2 pr-8">
          <div className="w-4/5">____________, ____________</div>
          <div className="mt-2 h-[15mm]" />
          <div className="border-t-2 border-black w-4/5 mt-2 pt-1">
            Contracting Party 2 – Signature/Stamp
          </div>
        </div>
      </div>
    </PagedDocument>
  )
}
