import type { ContractData, ContractParty } from '../../../../main/api/schemas/contract.schema'
import { PagedDocument } from '../print/PagedDocument'
import { contractDeposits } from './contractSections'

// ========================================
// English concert contract
// ========================================

// Built from the two English concert templates the user provided, which are legally reviewed:
// a "Concert Performance Agreement" (the structure, the deal sheet and the general terms) and
// a shorter guest appearance contract (tickets, helpers, stage, dressing room, merchandise).
// Their wording is kept and marked "Template:", with the parties called Artist, Promoter and
// Agent as in the templates; "Adapted:" marks a template clause whose fixed values (names,
// numbers, places) gave way to the app's data. Everything identifying the templates' authors
// is left out: names, addresses, the place of jurisdiction. German-only clauses without a
// template counterpart are collected under "Additional Terms", marked "Translated:", and
// listed in docs/CONTRACT_TRANSLATIONS.md for legal review. Unlike the German contract this
// one is not numbered in the German contract's order; it follows the templates.

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

// ========================================
// Layout pieces (the template's deal sheet: headed blocks of label/value rows)
// ========================================

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 break-inside-avoid">
      <h3 className="mb-1 border-b border-black text-[11pt] font-bold tracking-wide">{title}</h3>
      <table className="w-full text-[10pt] leading-snug">
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="align-top">
      <td className="w-[38mm] py-0.5 pr-3 font-semibold">{label}:</td>
      <td className="py-0.5">{children}</td>
    </tr>
  )
}

function Term({
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
      <h3 className="mb-1 text-[10.5pt] font-bold">
        {number}) {title}
      </h3>
      <div className="space-y-2 text-justify text-[9.5pt] leading-relaxed">{children}</div>
    </div>
  )
}

function PartyLines({ party }: { party: ContractParty }) {
  const street = [party.street, party.streetNumber].filter(Boolean).join(' ')
  const city = [party.zipCode, party.city].filter(Boolean).join(' ')
  return (
    <div className="leading-snug">
      <div className="font-bold">{party.name}</div>
      {street && <div>{street}</div>}
      {city && <div>{city}</div>}
      {party.country && <div>{party.country}</div>}
      {party.vatId && <div>VAT ID: {party.vatId}</div>}
    </div>
  )
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
  const today = formatDate(localIsoDate(new Date()))
  const artistName = band?.name ?? artist?.name ?? '-'

  const guarantee = dealMemo.guaranteeAmount
  const vatRate = dealMemo.guaranteeVatRate
  const guaranteeVat = guarantee !== null && vatRate !== null ? (guarantee * vatRate) / 100 : null
  const guaranteeGross = guarantee !== null ? guarantee + (guaranteeVat ?? 0) : null
  const plusVat = vatRate !== null && vatRate > 0 ? ` plus ${formatVatRate(vatRate)}% VAT` : ''
  const deposits = contractDeposits(dealMemo)

  // General terms are numbered in print order; the special agreements are optional
  let term = 0
  const next = () => ++term

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
      <h1 className="mb-6 text-center text-[16pt] font-bold tracking-wide">
        CONCERT PERFORMANCE AGREEMENT
      </h1>

      {/* Template: parties */}
      <div className="mb-6 space-y-3 text-[10pt]">
        <p>
          <span className="font-semibold">Contract/Agreement Date:</span> {today}
        </p>
        <p>by and between</p>
        {artist ? <PartyLines party={artist} /> : <div className="font-bold">{artistName}</div>}
        <p>(hereinafter referred to as “Artist”)</p>
        <p>and</p>
        {promoter ? <PartyLines party={promoter} /> : <div>-</div>}
        {promoter?.representative && <p>Who signs: {promoter.representative}</p>}
        <p>(hereinafter referred to as “Promoter”)</p>
        {representative && (
          <>
            <p className="font-semibold">Represented by:</p>
            <PartyLines party={representative} />
            <p>(hereinafter referred to as “Agent”)</p>
            <p className="text-justify">
              It is made clear that Agent only acts as the duly authorised representative of Artist
              within the context of the conclusion and execution of this agreement and that Agent
              does not become a contractual party of Promoter and particularly does not owe Promoter
              any artistic performance and/or service.
            </p>
          </>
        )}
        <p className="text-justify">
          It is understood and mutually agreed that the Promoter engages the Artist to perform the
          following engagement upon all the terms and conditions hereinafter set forth:
        </p>
      </div>

      {/* Template: deal sheet */}
      <Block title="SHOW INFORMATION">
        <Row label="Artist">{artistName}</Row>
        <Row label="Date of Performance">{formatDate(dealMemo.date)}</Row>
        <Row label="Venue">{venue?.name || '-'}</Row>
        {venue?.city && <Row label="City">{venue.city}</Row>}
        {venue?.capacity ? <Row label="Venue Capacity">{venue.capacity} ppl</Row> : null}
      </Block>

      <Block title="SCHEDULE">
        <Row label="Show Time">{dealMemo.performanceTime || '-'}</Row>
        <Row label="Set Length">{dealMemo.performanceDuration || '-'}</Row>
        {dealMemo.performanceInformation && (
          <Row label="Other">{dealMemo.performanceInformation}</Row>
        )}
      </Block>

      <Block title="DEAL">
        <Row label="Deal">
          {/* Template: "The Promoter agrees to pay for this performance …"; guarantee sentence
              from the guest appearance contract */}
          {guarantee !== null && (
            <div className="font-bold">
              The Promoter agrees to pay for this performance a guarantee of{' '}
              {formatMoney(guarantee)}
              {plusVat ? `${plusVat} (total: ${formatMoney(guaranteeGross ?? 0)})` : ''}.
            </div>
          )}
          {dealMemo.deal && <div className="whitespace-pre-wrap">{dealMemo.deal}</div>}
          {guarantee === null && !dealMemo.deal && '-'}
        </Row>
      </Block>

      <Block title="TERMS OF PAYMENT">
        {deposits.map((deposit, index) => (
          <Row
            key={index}
            label={deposits.length > 1 ? `Advance Payment ${index + 1}` : 'Advance Payment'}
          >
            {formatMoney(deposit.amount)}
            {plusVat}, due {deposit.dueDate ? `by ${formatDate(deposit.dueDate)}` : 'on signature'}
          </Row>
        ))}
        <Row label="Payment">After invoices, by bank transfer.</Row>
        <Row label="Bank Account">
          {artist?.accountHolder || artist?.name || '-'}
          <br />
          Bank: {artist?.bankName || '-'}
          <br />
          IBAN: {artist?.iban || '-'}
          <br />
          BIC: {artist?.bic || '-'}
        </Row>
      </Block>

      {/* Template: production rows ("at Promoter's sole expense") */}
      <Block title="PRODUCTION">
        <Row label="Stage">
          Provided by Promoter (at Promoter’s sole expense) according to Artist’s rider.
        </Row>
        <Row label="PA & Lights">
          Provided by Promoter (at Promoter’s sole expense) according to Artist’s rider.
        </Row>
        <Row label="Backline">Provided by Artist.</Row>
        <Row label="Catering/Hospitality">
          Provided by Promoter (at Promoter’s sole expense) according to Artist’s rider.
        </Row>
        {/* Adapted: persons and rooms from the event */}
        <Row label="Accommodation">
          Hotel rooms incl. breakfast to be provided by Promoter (at Promoter’s sole expense) for{' '}
          {dealMemo.amountOfPeople ?? '-'} persons
          {dealMemo.roomInformation ? `: ${dealMemo.roomInformation}` : ''}
          {hotel ? `. Hotel: ${hotel.name}` : ''}.
        </Row>
        {technician && (
          <Row label="Artist’s Production Contact">
            {technician.firstName} {technician.lastName}
            {technician.mobilePhone || technician.email
              ? `, ${[technician.mobilePhone, technician.email].filter(Boolean).join(', ')}`
              : ''}
          </Row>
        )}
      </Block>

      <Block title="MISCELLANEOUS">
        {dealMemo.posters && <Row label="Posters">{dealMemo.posters}</Row>}
        {/* Adapted: at least ten, as in the German contract */}
        <Row label="Guest List">
          Artist is entitled to put at least 10 (ten) people on the guest list.
        </Row>
        <Row label="Filming & Streaming Rights">
          Any filming, broadcasting, or streaming rights are subject to negotiation with Artist
          resp. Artist’s label/publisher/rightsholder.
        </Row>
      </Block>

      <h2 className="mb-3 mt-6 text-[12pt] font-bold tracking-wide">GENERAL TERMS</h2>

      <Term number={next()} title="RIDER">
        <p>
          Any Technical Rider, Hospitality Rider or Catering Rider provided by Artist or Agent will
          become an essential part of this agreement, even if such Rider is communicated after the
          conclusion of this contract.
        </p>
      </Term>

      <Term number={next()} title="PA / LIGHTS / STAGE">
        <p>
          It is agreed and understood that the Promoter will provide and pay for an appropriate PA
          and lighting system as set out in the Artist’s Technical Rider. The Promoter agrees to
          provide a safe and level stage, suitable to the size and capacity of the venue. Any
          specific needs from the Artist side have to be taken and fully complied with out of the
          Technical Rider.
        </p>
        <p>
          The stage is to be firmly fixed with a level and even surface and is to be provided solely
          for the use of the Artist and its equipment (unless otherwise agreed). In the case of open
          air concerts the Promoter is to provide waterproof protection for the stage to allow for
          an uninterrupted performance.
        </p>
      </Term>

      <Term number={next()} title="HOSPITALITY / CATERING">
        <p>
          It is agreed and understood that the Promoter will provide and pay for the Artist’s
          catering and hospitality according to the Artist’s Hospitality and Catering Rider.
        </p>
      </Term>

      {/* Template; the template's fixed penalty per vehicle is left out */}
      <Term number={next()} title="PARKING / VEHICLES">
        <p>
          Promoter will ensure that all touring vehicles are provided with a parking space and
          electricity (1 x 32A per nightliner) near to the entrance/stage door. The costs are borne
          by the Promoter.
        </p>
      </Term>

      <Term number={next()} title="STAFF">
        <p>
          Promoter makes sure to provide and pay for skilled technical staff as well as sober and
          able-bodied stagehands, according to Artist’s Technical Rider. Staff members/stagehands
          shall be present straight from the Artist’s arrival until load out is completely finished.
        </p>
        {/* Adapted: at least two helpers, as in the German contract */}
        <p>
          The Promoter will provide at least two (2) strong helpers to transport equipment
          (backline) to and from the truck and to set up and dismantle the equipment on stage.
        </p>
      </Term>

      {/* Template; "e.g. GEMA in Germany" added */}
      <Term number={next()} title="PERMITS / LICENCES / COLLECTING SOCIETIES">
        <p>
          Promoter will be committed to notify the authorities and any other concerned third party
          of the contractual performance, if legally required; and to apply for all required
          permissions and to bear any costs in respect to such permissions. Promoter shall be
          obliged to notify the collecting society (e.g. GEMA in Germany) of the contractual
          performance and the performed works in due time and to submit the respective forms to the
          collecting society also in due time. For this purpose, Promoter will inform Artist in a
          timely manner and explicitly request any and all information required by Promoter to
          fulfil this obligation. All royalties resulting from this obligation shall be borne and
          paid by Promoter. At the request of the Artist, the Promoter has to provide the respective
          collecting society with proof of the notification and payment. Promoter shall indemnify
          Artist and Crew against any damages, claims, costs, fees, penalties etc. incurred in
          connection with any failure or delay by Promoter.
        </p>
      </Term>

      <Term number={next()} title="TICKETS / SHOW COSTS">
        <p>
          The Promoter has to arrange the advance bookings and bookings on the day. Only numbered
          tickets are to be sold.
        </p>
        <p>
          Where the deal includes a share of the takings, the Promoter has to provide full
          documentation and receipts for costs on the day of the concert or that item will not be
          accepted as a show cost. In-built profits of the Promoter will not be accepted as
          production costs.
        </p>
      </Term>

      <Term number={next()} title="SECURITY / SAFETY">
        <p>
          Promoter is obliged to guarantee the security and safety of the Artist and its crew. It
          includes safety for all instruments and equipment, costumes and personal property of
          Artist and its crew during and after their performance. Security staff shall be located on
          stage and in front of all entrances and exits to the dressing rooms. Promoter is obliged
          to provide crash barriers in front of the stage and around the front of house (“FoH”). In
          case of any damage of the Artist’s property, also in case of any personal damage to Artist
          and crew members, Promoter shall be obliged to pay all damages, including collateral and
          consequential damages and losses suffered by the Artist and/or its crew.
        </p>
        <p>
          During setting up of equipment no unauthorised persons are to be allowed in the room and
          on stage. The Promoter is to assure that the stage is not accessible to the audience
          during the whole performance. The audience is only to be admitted after the Artist’s sound
          check.
        </p>
        <p>
          Promoter is responsible for the security of the backstage area. The Artist must be
          provided with dressing-room facilities for its sole use during the performance. The
          dressing room must be heated and able to be locked, but if this is not possible officials
          are to be posted to guard the dressing room. In the dressing room at least one mirror and
          at least one towel is to be provided per musician.
        </p>
      </Term>

      <Term number={next()} title="PROMOTION">
        <p>
          Promoter agrees that it will promote the show to the best of its possibilities. The
          Promoter receives free press material to ensure that the venue has an attendant audience
          in keeping with its capacity. All promotional items must be approved by Artist, Agent or
          the Artist’s management before being printed or published.
        </p>
      </Term>

      <Term number={next()} title="MERCHANDISE">
        <p>
          The Artist is entitled to sell T-shirts and other merchandise articles before, during and
          after the concert.
        </p>
      </Term>

      <Term number={next()} title="PAYMENTS / SETTLEMENT">
        <p>
          All payments defined by this agreement shall not depend on the artistic success of
          Artist’s contractual performance with the audience.
        </p>
        <p>
          If Promoter fails to account for, prove and pay out the contractual remuneration as agreed
          herein in due time, this breach of obligation shall be considered a compelling reason
          under the law. In this case, the Artist may terminate this contract at any time and
          without any notice. The Artist is therefore not obligated to fulfil its performance,
          whereas Promoter shall be obliged to fully fulfil its payment obligations hereunder
          (payment of fees, payment of commission of Agent, payment of expenses of Artist etc.). In
          such case it shall be legally assumed that Promoter’s payment obligations hereunder equal
          the amount of damages that Artist is legally entitled to.
        </p>
      </Term>

      <Term number={next()} title="PRESENTATION / PERFORMANCE">
        <p>
          Promoter is familiar with the Artist’s artistic style and the way of its presentation and
          performance. The type of performance and style is exclusively the responsibility of
          Artist. Artist shall not be subject to the Promoter’s instructions concerning the
          performance.
        </p>
      </Term>

      <Term number={next()} title="CONCERT FAILURE / CANCELLATION">
        <p>
          In case Artist’s performance is prevented by reasons Promoter or any other representative
          of Promoter shall be held responsible for, this breach of contract by Promoter shall also
          be considered a compelling reason under the law. Promoter shall be obliged to fully fulfil
          its payment obligations hereunder (payment of fees, commission, Agent, expenses of Artist
          etc.). In such case it shall be legally assumed that Promoter’s payment obligations
          hereunder equal the amount of damages that Artist is legally entitled to.
        </p>
        <p>
          In case the contractual performance(s) may be cancelled at any time after the conclusion
          of this agreement and due to reasons Artist cannot be found liable for (except for
          cancellations due to force majeure events as defined below), Artist shall not be obliged
          to fulfil the contractual obligations related to the cancelled performance(s). In such
          case, Promoter is still obliged to pay to Artist the full amounts as agreed herein. Artist
          shall be entitled to a general compensation of damages limited to all costs pursuant to
          the contract incurred by Artist in connection with the contractual performance(s).
          Artist’s further rights and claims in connection with an engagement being cancelled by
          Promoter through no fault of the Artist shall remain unaffected.
        </p>
        <p>
          Neither party shall be in breach of its obligations under this agreement or incur any
          liability to the other party for any losses or damages of any nature whatsoever incurred
          or suffered by that other party (otherwise than under any expressly mentioned indemnity in
          this agreement), if and to the extent that it is prevented from carrying out those
          obligations or such losses or damages are caused by a Force Majeure Event, except to the
          extent that the relevant breach of its obligations would have occurred, or the relevant
          losses or damages would have arisen, even if the Force Majeure Event had not occurred.
        </p>
        <p>Force Majeure Event means the occurrence of:</p>
        <ol className="list-[lower-alpha] space-y-1 pl-6">
          <li>
            an act of war (whether declared or not), hostilities, fights, terrorism or civil unrest;
          </li>
          <li>
            strikes or other industrial action or blockades or any other form of civil disturbance,
            provided that the incident is beyond the reasonable control of Promoter;
          </li>
          <li>
            specific incidents of exceptional adverse weather conditions: tempest, earthquake or any
            other natural disaster;
          </li>
          <li>general discontinuation of electricity supply;</li>
          <li>
            other unforeseeable circumstances beyond the control of the parties against which it
            would have been unreasonable for the affected party to take precautions and which the
            affected party cannot avoid even by using its best efforts,
          </li>
        </ol>
        <p>
          which in each case directly causes either party to be unable to comply with all or a
          material part of its obligations under this agreement.
        </p>
        <p>
          As soon as reasonably practicable, any party invoking a Force Majeure Event shall submit
          proof of the nature of the event and its effects on the execution of this agreement and
          respective party’s obligations hereunder.
        </p>
        <p>
          In case of any dangerous weather conditions, actual or threatening riots or civil
          disorder, which in the Artist’s opinion may result in danger or injury to the Artist or
          its staff or in damage to the Artist’s equipment as well as in case of any circumstances
          which may cause danger to any persons, including but not limited to faulty, insufficient
          or any other dangerous conditions, the Artist reserves the right to decline to perform or
          shorten its performance without any impact and/or consequence on the Promoter’s obligation
          to pay the full agreed fee(s) and remunerations as specified above.
        </p>
      </Term>

      <Term number={next()} title="FILMING / BROADCASTING / STREAMING">
        <p>
          Any audio and/or audio-visual recording, filming, broadcasting, streaming etc. of the
          contractual performance(s) and/or other footage (such as backstage/behind the scenes
          footage of Artist and/or crew) by Promoter (or third parties) shall be strictly prohibited
          unless subject to a separate agreement with Artist or Artist’s representative (e.g.
          management, label and/or publisher). Promoter shall instruct its contractual partners,
          service providers, employees etc. to comply with these terms and Promoter shall ensure
          that no third party shall record, film, broadcast, stream and/or otherwise exploit the
          contractual performance and/or other footage (as above). In any case such recordings by
          Promoter and/or third party shall be delivered to Artist immediately but within one week
          after the respective contractual performance at the latest. For clarification purposes
          only, parties agree that any recording manufactured without the expressed consent of
          Artist shall not be subject to any subsequent exploitation (if not agreed on in writing).
        </p>
        <p>
          Artist may audio and/or audio-visually record, film, broadcast, stream the contractual
          performance(s) (and/or backstage/behind the scenes footage) and/or commercially exploit
          the recordings of contractual performance(s) and/or other backstage/behind the scenes
          footage at its sole discretion (e.g. particularly by means of online streaming/gaming
          services, sound/video carriers, such as DVDs, CDs, LPs, commercials etc.) without any
          fees, charges etc. by Promoter or any third party. Any necessary consent and/or grant of
          right by Promoter shall be deemed given. Promoter or respective third party shall have no
          right to any further remuneration. This provision shall analogously apply in regard to any
          prohibited footage/recordings by Promoter and/or third parties (as above) – Artist may use
          and exploit such recordings without any further consent and/or without any further
          remuneration, charges, fees etc.
        </p>
      </Term>

      <Term number={next()} title="TAXES">
        <p>
          Unless otherwise agreed hereunder, all payments by Promoter to Artist shall in no event be
          subject to taxes (especially withholding tax), social security, fees and charges
          (including but not limited to any incidental transfer and transaction costs, especially
          bank service charges and conversion charges). All pertinent taxes, the social security,
          fees and charges (including but not limited to any incidental transfer and transaction
          costs, especially bank service charges and conversion charges) shall be solely
          (additionally) paid by Promoter on top of the agreed fees and remuneration and shall
          therefore in no event be deducted from the agreed fees and remuneration. Any received
          payments under this Agreement are non-refundable.
        </p>
        <p>
          Notwithstanding the foregoing and only in the event that Promoter is required by law to
          withhold/deduct and/or pay (income) tax for/on behalf of Artist with respect to the
          Artist’s contractual performance(s), Promoter shall provide Artist with an internationally
          acknowledged tax certificate, issued by the competent authority in the country of the
          event, immediately but within four (4) months following the contractual performance(s) of
          Artist at the latest. This obligation constitutes a material obligation under this
          Agreement. If Promoter fails to provide Artist with such a tax certificate in due time,
          Promoter shall be obliged to additionally refund the withheld/paid amount directly to
          Artist.
        </p>
      </Term>

      <Term number={next()} title="INJURY / PROPERTY DAMAGE">
        <p>
          Promoter hereby indemnifies and holds Artist, Artist’s travel party and/or Agent/other
          vicarious agents of Artist free and harmless from and against any loss, damage or expense,
          including reasonable attorney’s fees, incurred or suffered by or threatened against
          Artist, Artist’s travel party and/or Agent/other vicarious agents of Artist in connection
          with or as a result of any claim, particularly any claim for personal injury or property
          damage or otherwise brought by or on behalf of any third party as a result of or in
          connection with this agreement and/or the contractual performance, always under the
          condition that such claim does not result from an act of intent or gross negligence of
          Artist, Artist’s travel party and/or Agent/other vicarious agents of Artist.
        </p>
      </Term>

      <Term number={next()} title="SPONSORING">
        <p>
          Artist may, at its sole discretion, announce and present commercial sponsoring partners
          with regard to the contractual performance(s). Artist shall be allowed to present such
          sponsoring partners, particularly visually display names, marks, logos, trademarks etc. of
          such partners on stage, backstage, inside and outside the venue, also in regard to any
          announcement or exploitation of audio/visual recordings (e.g. within a stream of the
          concert performance) without any restriction and/or further consent by Promoter and/or
          third party and also without any further charge, fee etc. at Artist’s sole discretion.
        </p>
      </Term>

      {/* Translated: German-only clauses without a counterpart in the templates */}
      <Term number={next()} title="ADDITIONAL TERMS">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            If an advance payment is not received by Artist in time, only Artist is entitled to
            withdraw from the contract. Artist’s claims for damages remain unaffected.
          </li>
          <li>
            If Promoter is a political party, a company, an association or a similar organisation,
            this must be expressly disclosed before the contract is concluded. The involvement of
            any sponsors, presenters or other advertisers of Promoter requires written agreement
            with Artist. Advertising material such as banners, posters or flags in the immediate
            stage area is generally not permitted. Artist may hang a backdrop with its logo (4 m x 3
            m) on the back wall of the stage during its performance.
          </li>
          <li>
            If there is no central merchandise seller, Promoter provides Artist free of charge with
            a dry, well-lit sales area with two tables, one chair and a 220 V power connection, in a
            busy spot no more than 30 metres from the stage.
          </li>
          <li>
            In addition to the guest list places, Artist may put other promoters, record company
            representatives, media partners, endorsement partners etc. on the guest list.
          </li>
          <li>
            Promoter ensures that no weapons or weapon-like objects are brought into the venue. At
            concerts there is a risk of damage to hearing and health due to the volume; Promoter
            puts up a sign at the entrance clearly drawing concert-goers’ attention to these risks.
            Artist is not liable for any consequential damage.
          </li>
          <li>
            If Artist or members of Artist are engaged in film, radio or television for the date of
            the concert and this only became known after the conclusion of the contract, Promoter
            releases Artist from this contract for that purpose. Artist notifies Promoter as soon as
            possible; both parties bear their own costs and will endeavour to find an alternative
            date.
          </li>
          <li>
            The signed contract, including the signed rider, is to be returned to{' '}
            {artist?.name ?? artistName}
            {artist?.email ? ` (${artist.email})` : ''} within two weeks of receipt. If it has not
            been returned within 21 days of receipt, all contract details stated by Artist are
            deemed accepted by Promoter.
          </li>
        </ul>
      </Term>

      {/* Template; without the template's place of jurisdiction */}
      <Term number={next()} title="MISCELLANEOUS">
        <p>
          The parties herewith represent, warrant and undertake that they have the full right and
          authority to enter into this agreement.
        </p>
        <p>
          The Agreement is solely governed by and construed in accordance with the laws and
          procedures of the Federal Republic of Germany, to the exclusion of the conflict of law
          rules of German international private law and the provisions of the UN Sales Convention.
        </p>
        <p>
          No variations of any of the terms or conditions hereof (including the written form
          requirement set forth in this clause) and any additions may be made unless such variation
          and/or addition is agreed in writing and signed by both parties hereto.
        </p>
        <p>
          If any provision of the Agreement is held invalid, illegal or unenforceable, the validity,
          legality or enforceability of the remaining provisions will not in any way be affected or
          impaired thereby. The Parties hereto shall negotiate in good faith to replace any invalid,
          illegal, unenforceable or incomplete provision with a valid provision, the effect of which
          comes as close as possible to that of the intention of the Parties hereto.
        </p>
        <p>The right to ordinary termination by the Promoter shall be excluded.</p>
        <p>
          All conditions contained in this agreement are strictly confidential. All parties hereto
          agree to keep confidential all conditions herein, and the obligation for absolute
          confidentiality applies even after the Performance and/or termination of this Agreement.
        </p>
      </Term>

      {dealMemo.contractNotes && (
        <Term number={next()} title="SPECIAL AGREEMENTS">
          <p className="whitespace-pre-wrap">{dealMemo.contractNotes}</p>
        </Term>
      )}

      {/* Template: signatures. Never split, never alone on a page */}
      <div className="mt-10 break-before-avoid break-inside-avoid text-[10pt]">
        <p className="mb-4">Agreed to and accepted by and between:</p>
        <div className="flex">
          <div className="w-1/2 pr-8">
            <div className="font-bold">Artist</div>
            <div className="mt-2 w-4/5">
              {representative?.city || artist?.city || '____________'}, {today}
            </div>
            <div className="mt-2 h-[15mm]">
              {artistSignatureUrl && (
                <img src={artistSignatureUrl} alt="" className="max-h-full object-contain" />
              )}
            </div>
            <div className="mt-2 w-4/5 border-t-2 border-black pt-1">
              Place, Date – Signature/Stamp
              {representative && <div>p.p. {representative.name}</div>}
            </div>
          </div>
          {/* The Promoter fills in place, date and signature by hand: nothing is prefilled */}
          <div className="w-1/2 pr-8">
            <div className="font-bold">Promoter</div>
            <div className="mt-2 w-4/5">____________, ____________</div>
            <div className="mt-2 h-[15mm]" />
            <div className="mt-2 w-4/5 border-t-2 border-black pt-1">
              Place, Date – Signature/Stamp
            </div>
          </div>
        </div>
      </div>
    </PagedDocument>
  )
}
