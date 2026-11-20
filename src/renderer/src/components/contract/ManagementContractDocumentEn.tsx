import type { ManagementContractPrintData } from '../../../../main/api/schemas/management_contract.schema'
import { PagedDocument } from '../print/PagedDocument'
import { PartyBlock, Section } from './managementContractParts'
import { englishNumberWithWord, englishQuantity } from '@/lib/englishNumbers'

// ========================================
// English management agreement
// ========================================

// Wording from the English VUT management agreement sample (2016) the user provided, with
// every clause matched to the German contract (ManagementContractDocument.tsx): same
// sections, same terms, the same choice where the sample offers alternatives. Passages
// changed to match the German contract are marked "Adapted:" and listed in
// docs/CONTRACT_TRANSLATIONS.md for legal review.

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`
}

// The territory is free text, stored in German; its usual values read as English
const TERRITORY_EN: Record<string, string> = {
  'örtlich unbeschränkt': 'without restrictions as to territory',
  weltweit: 'worldwide'
}

function territoryText(territory: string): string {
  const value = territory.trim()
  return TERRITORY_EN[value.toLowerCase()] ?? `within the following territory: ${value}`
}

export function ManagementContractDocumentEn({
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

      <h1 className="mb-6 text-center text-[16pt] font-bold tracking-wide">MANAGEMENT AGREEMENT</h1>

      {/* Parties */}
      <div className="mb-8 space-y-3 text-center text-[10pt]">
        <p>between</p>
        <PartyBlock party={management} fallback="(no management selected)" />
        <p>– hereinafter referred to as MANAGEMENT –</p>
        <p>and</p>
        <PartyBlock party={artist} fallback={artistName} />
        <p>– hereinafter jointly and severally referred to as “ARTIST” –</p>
      </div>

      <Section number={1} title="Subject Matter of the Agreement">
        {/* Adapted: activities limited to musician, composer and lyricist, like the German contract */}
        <p>
          The ARTIST is active in the entertainment industry, mainly as musician, composer and
          lyricist (hereinafter referred to as the “Career”). ARTIST will, inter alia, on his own or
          jointly with others, create audio and video records and will present and exploit works by
          way of public presentations and performances, be it solo live performances or in the
          context of a tour or in radio or TV shows or other media.
        </p>
        <p>
          Subject matter of this Agreement is the support of {artistName} in relation to the
          development and fostering of his Career. In this context, MANAGEMENT advises ARTIST
          exclusively in relation to all artistic, organisational and financial matters.
        </p>
        <p>
          The placement of ARTIST into a dependent employment as an employee or the arrangement of
          an employment relationship is not the subject matter of this Agreement. Neither the German
          Employment Service Act nor the German Employment Service Regulation apply to this
          Agreement.
        </p>
      </Section>

      <Section number={2} title="Contract Territory">
        <p>
          ARTIST hereby instructs MANAGEMENT with legally binding effect to carry out its
          contractual duties {territoryText(c.territory)}.
        </p>
      </Section>

      <Section number={3} title="Contractual Term">
        <p>
          The term of the Agreement commences with the last signing of this Agreement and runs for a
          duration of {englishQuantity(c.termYears, 'year', 'years')}. The term shall renew
          automatically for the duration of successive{' '}
          {englishQuantity(c.renewalYears, 'year', 'year')} periods provided that the Agreement is
          not terminated by giving {englishQuantity(c.noticeMonths, 'month’s', 'months’')} notice in
          writing prior to the expiry of the respective current term.
        </p>
        <p>
          The above shall go without prejudice to the statutory right to an immediate termination
          for cause.
        </p>
        <p>
          Notices of termination shall only be effective if served by way of a registered letter.
        </p>
      </Section>

      <Section number={4} title="Principles of the Cooperation">
        <p>
          The Parties agree that only an intense and trusting cooperation will benefit the Career of
          the ARTIST. Therefore, the principles of the cooperation, any public relations measures
          and any related measures shall be coordinated by way of mutual agreement between the
          Parties.
        </p>
        <p>
          The Parties shall endeavour to meet and to communicate over the telephone on a regular
          basis. MANAGEMENT shall inform ARTIST regularly – at least once per month – about the
          respective plans and activities of MANAGEMENT by way of sending a “Progress Report” via
          email.
        </p>
      </Section>

      <Section number={5} title="Services to be rendered by MANAGEMENT">
        <p>
          ARTIST hereby instructs MANAGEMENT exclusively to represent his artistic, media-related
          and financial interests regarding the entirety of his artistic activities and to cater for
          all organisational matters arising in the context of the Career of ARTIST within the
          contractual territory for the duration of the term. MANAGEMENT shall in particular take
          care of the following matters in close cooperation with ARTIST:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            the development, conceptualisation, planning and fostering of the Career of ARTIST;
          </li>
          <li>
            the representation of the artistic, media-related and financial interests of ARTIST in
            relation to third parties (e.g. publishing companies, record labels, booking agencies);
          </li>
          <li>
            advice for ARTIST regarding his artistic activities (e.g. audio and video productions,
            in particular choice of producers, concert and tour performances, stage performance,
            cover design, internet presence) and his styling and image;
          </li>
          <li>
            complementary advice for ARTIST in relation to all contractual arrangements relevant for
            the Career (e.g. agreements regarding publishing, recordings, tours or other kinds of
            exploitation) and negotiation of the commercial terms of such agreements. MANAGEMENT is,
            following the prior written consent of ARTIST, entitled to instruct a third party, e.g.
            an attorney at law, to conduct such negotiations at the expense of ARTIST; this shall in
            particular apply when legal advice is sought;
          </li>
          <li>
            the organisation, coordination and preparation of promotional and marketing-related
            measures, e.g. interviews with TV and radio broadcasters or producers as well as with
            print media which enhance the image of ARTIST and support the popularisation of his
            name, in addition to respective measures taken by third parties;
          </li>
          <li>
            complementary advice in relation to the review of royalty statements of ARTIST.
            MANAGEMENT is, following the prior written consent of ARTIST, entitled to instruct a
            third party, e.g. an accountant, with such review at the expense of ARTIST.
          </li>
        </ul>
        <p>
          In addition, MANAGEMENT shall use all reasonable endeavours in order to support the ARTIST
          and foster the ARTIST’s image. MANAGEMENT shall deepen and shall make use of existing
          contacts to relevant business partners (e.g. producers, record labels, distributors,
          publishing companies, concert agencies, promoters, the press, radio and television,
          internet platforms as well as producers of video games, advertising agencies and other
          companies that are active in the media industry) for the benefit of ARTIST and/or the
          performances and works of ARTIST.
        </p>
        <p>
          MANAGEMENT hereby undertakes to maintain detailed records regarding any transactions which
          form part of the contractual subject matter and to allow ARTIST to peruse these records
          during business hours upon demand.
        </p>
        {/* Adapted: delegation only without extra costs or with agreed costs (German § 5) */}
        <p>
          MANAGEMENT may delegate the performance of the contractual duties and services to third
          parties, provided that this causes no additional costs for ARTIST or that any additional
          costs have been agreed upon by mutual consent.
        </p>
      </Section>

      <Section number={6} title="Authorisation of MANAGEMENT">
        <p>
          ARTIST hereby grants MANAGEMENT an unlimited power of attorney (POA) to negotiate on
          behalf of ARTIST in the context of the performance of the contractual duties of
          MANAGEMENT. However, MANAGEMENT is neither entitled nor authorised to enter into binding
          agreements on behalf of ARTIST, unless ARTIST authorises MANAGEMENT to do so on a
          case-by-case basis. Such a POA to legally bind ARTIST can be granted in writing or by way
          of an email.
        </p>
      </Section>

      <Section number={7} title="Exclusivity">
        <p>
          Exclusivity applies to the person of ARTIST in his capacity as artist and as such, to all
          pseudonyms and alter egos which ARTIST uses in the context of his artistic activities and
          performances within the entirety of the contract territory for the duration of the term.
          Where ARTIST is a partnership or an entity, exclusivity applies to each individual partner
          or shareholder respectively as well as to any alter egos and pseudonyms used by them
          during the contractual term.
        </p>
        <p>
          ARTIST hereby appoints MANAGEMENT as his sole and exclusive MANAGEMENT for the duration of
          the term. MANAGEMENT is exclusively entitled to carry out the contractual performances and
          to present itself as the exclusive MANAGEMENT of ARTIST in relation to third parties.
        </p>
        {/* Adapted: delegation in consultation with ARTIST (German § 7) */}
        <p>
          MANAGEMENT is not obliged to be exclusively at the disposal of ARTIST. MANAGEMENT is
          entitled to manage third parties, even where these compete with ARTIST. MANAGEMENT is
          entitled to delegate or assign individual or all activities to be carried out in the
          context of the managerial work to various employees of MANAGEMENT or to third parties;
          this shall be done in consultation with ARTIST.
        </p>
      </Section>

      <Section number={8} title="Remuneration of MANAGEMENT">
        {/* Adapted: list of earnings as in the German contract (no separate "neighbouring
            rights" item); the excluded income sentence */}
        <p>
          MANAGEMENT shall receive for the performance of its contractual duties a remuneration of{' '}
          <strong>{formatPercent(c.commissionPercent)}</strong> (exclusive of statutory VAT) of all
          net earnings of ARTIST which the latter receives on account of his artistic activities
          and/or from the exploitation of musical works which ARTIST has created and/or edited in a
          capacity of composer and/or lyricist (e.g. earnings from record sales or other types of
          exploitations of recordings of ARTIST, fees for live performances and earnings from other
          types of performances, earnings from merchandising, earnings from appearances in films,
          television, radio and theatre as well as earnings from testimonial and advertising
          contracts and other types of exploitation agreements whose subject matter is the
          exploitation of ancillary copyrights, name, reputation or image of ARTIST).
          {c.excludedIncome.trim() && ` Excluded from this are: ${c.excludedIncome.trim()}.`}
        </p>
        <p>Net earnings are defined as follows:</p>
        <p>
          Gross earnings received by or credited to ARTIST in consideration of his artistic
          activities (but not mere reimbursements of expenses or other cost reimbursements) minus:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>statutory VAT and/or other sales tax(es) as well as</li>
          <li>
            any – previously agreed with MANAGEMENT in writing – production costs and third party
            assignments (e.g. involvement of hired musicians, booking agencies) which are to be
            borne by ARTIST.
          </li>
        </ul>
        <p>
          Apart from the above, it is irrelevant for the calculation of the net earnings as
          calculation basis for the remuneration of MANAGEMENT which other costs or third party
          claims are to be borne by ARTIST.
        </p>
        {/* Adapted: only earnings generated under the artist's name (German § 8) */}
        <p>
          The term net earnings comprises any remuneration which ARTIST may receive, irrespective of
          how and subject to which designation such remuneration may be paid out (e.g. as wages,
          bonuses, share of the turnover, profit participation, advance payments or guarantee
          payments, payments in kind, company shares or similar shares in entities or enterprises
          and any other cash-equivalent benefits). This only applies to earnings generated under the
          name {artistName}.
        </p>
        <p>
          It is irrelevant for the determination of the share of MANAGEMENT whether a contract or
          the earnings of ARTIST can be attributed to a direct involvement of MANAGEMENT. MANAGEMENT
          has a claim to remuneration for all exploitation measures taken during the contract term
          and, subject to the requirements of Section 13, exploitation measures taken during the
          post-contractual remuneration period.
        </p>
      </Section>

      <Section number={9} title="Accounting Procedure">
        {/* Adapted: quarterly instead of monthly, objection within one month (German § 9) */}
        <p>
          The calculation of the share of MANAGEMENT pursuant to Sections 8 and 13 shall be carried
          out by ARTIST on a quarterly basis within {englishNumberWithWord(c.settlementDays)} days
          following the end of the quarter in which ARTIST has received the relevant earnings. In
          doing so, ARTIST shall – upon demand of MANAGEMENT – produce any receipts on which the
          calculation of the MANAGEMENT share is based to MANAGEMENT. Accounts shall be communicated
          via email, until further notice to the following email address:{' '}
          <strong>{c.statementEmail || '________________'}</strong>
        </p>
        <p>
          Accounts shall be deemed to have been approved where MANAGEMENT does not object to them
          within one month following their receipt and specifies reasons for doing so.
        </p>
        <p>Payments shall discharge any debt owed if remitted to the following bank account:</p>
        <div className="break-inside-avoid pl-5 font-semibold leading-snug">
          <div>{management?.accountHolder || management?.name || '________________'}</div>
          <div>{management?.bankName || 'Bank: ________________'}</div>
          <div>IBAN: {management?.iban || '________________'}</div>
          <div>BIC: {management?.bic || '________________'}</div>
        </div>
        <p>
          Payments to MANAGEMENT shall be made within {englishNumberWithWord(c.paymentDays)} days
          following the receipt of a valid invoice by ARTIST.
        </p>
        <p>
          ARTIST undertakes to enforce any claims for payment which may arise from agreements
          entered into with third parties vis-à-vis such third parties and, if necessary, to take
          all steps required for the collection of any amounts due which have not been paid by third
          parties in due time.
        </p>
      </Section>

      <Section number={10} title="Obligations of ARTIST and Guarantee">
        <p>
          ARTIST hereby agrees to forward any requests from third parties which he receives in the
          course of his artistic activities to MANAGEMENT and not to negotiate on his own behalf.
        </p>
        <p>
          ARTIST shall notify MANAGEMENT in due course about any absence or holidays, etc. ARTIST
          shall notify MANAGEMENT two (2) months in advance of holiday-related absences in excess of
          10 days.
        </p>
        <p>
          In this context, ARTIST warrants that he will be available for any activities which form
          the subject matter of this Agreement (such as public performances, promotional efforts
          and/or audio-visual media productions) provided that these activities are in accordance
          with the artistic and commercial objectives of ARTIST and thus further the interests of
          ARTIST. However, ARTIST decides in his free discretion which artistic activities he wishes
          to pursue.
        </p>
        <p>
          ARTIST guarantees that there are no contracts in existence which would prohibit the
          conclusion of the present Agreement. In this respect, ARTIST will without limitation
          indemnify MANAGEMENT upon first demand in relation to any valid third party claims and
          will compensate MANAGEMENT in relation to any damage and loss suffered and expenses
          incurred, including any legal costs or lawyer fees.
        </p>
      </Section>

      <Section number={11} title="Advertising">
        <p>
          MANAGEMENT may advertise itself using the name and authorised images of ARTIST and/or by
          way of mentioning the fact that MANAGEMENT is exclusively entrusted with the management of
          ARTIST.
        </p>
      </Section>

      <Section number={12} title="Taxes">
        <p>
          ARTIST is responsible for his tax liabilities arising from any remuneration received that
          falls within the scope of this Agreement. MANAGEMENT may, having obtained the prior
          written consent of ARTIST on a case-by-case basis, instruct a tax advisor on behalf and at
          the expense of ARTIST.
        </p>
      </Section>

      <Section number={13} title="Post-contractual Claim to Remuneration (“Sunset Clause”)">
        <p>
          MANAGEMENT has a claim to remuneration pursuant to Section 8 for the entire duration of
          the contractual term. Following the termination of this Agreement (irrespective of the
          cause for the termination) the claim to remuneration of MANAGEMENT shall be reduced as
          follows:
        </p>
        {/* Adapted: percentages from the contract record; no sentence on the fourth year */}
        <ul className="list-disc space-y-1 pl-5">
          <li>
            within the first year following termination to {formatPercent(c.postTermYear1Percent)}{' '}
            of the initial claim to remuneration;
          </li>
          <li>
            within the second year following termination to {formatPercent(c.postTermYear2Percent)}{' '}
            of the initial claim to remuneration;
          </li>
          <li>
            within the third year following termination to {formatPercent(c.postTermYear3Percent)}{' '}
            of the initial claim to remuneration.
          </li>
        </ul>
        <p>
          The Parties agree that MANAGEMENT shall only be entitled to a claim to a post-contractual
          remuneration for earnings deriving from the following contracts or agreements:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            any contracts entered into during the contractual term or contracts whose main
            characteristics have been negotiated during the contractual term;
          </li>
          {/* Adapted: "including by way of follow-up agreements" (German "auch durch Anschlussverträge") */}
          <li>
            any renewals or extensions (in particular such coming into force by way of exercise of
            an option) of and amendments to the aforementioned types of contracts, including by way
            of follow-up agreements.
          </li>
        </ul>
      </Section>

      <Section
        number={14}
        title="Travel Expenses, Expenditures, Disbursements, Office Expenditures"
      >
        <p>
          MANAGEMENT shall have a claim to remuneration that goes beyond the claim stipulated in
          Section 8 – subject to the prior consent of ARTIST – only in the following cases:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            travel costs and related expenses (such as accommodation costs and expenditures) which
            MANAGEMENT expends in relation to ARTIST;
          </li>
          <li>
            disbursements and any services which have expressly been approved (such as courier
            services).
          </li>
        </ul>
        <p>
          MANAGEMENT is obliged to evidence such expenses and may invoice ARTIST for such. ARTIST
          shall reimburse such expenses within thirty (30) days following the receipt of a
          respective written demand.
        </p>
        <p>
          Office expenditures or telephone charges incurred by MANAGEMENT because of its activities
          shall be at the expense of MANAGEMENT and may not be charged to ARTIST.
        </p>
      </Section>

      <Section number={15} title="Group Clause">
        <p>
          ARTIST within the meaning of this Agreement is the group / partnership with the name “
          {artistName}”. It consists of the following members / partners:
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
          The client of MANAGEMENT is the aforementioned group as well as the individual partners of
          said partnership in their capacity as individual artists. The exclusivity of this
          Agreement therefore applies to each member of the aforementioned group. MANAGEMENT shall
          be notified of any additions or departures of individual artists without delay. The group
          as well as any individual artist are obliged to ensure that any individual artists who
          join the group assume the rights and obligations arising from this Management Agreement.
        </p>
        <p>
          The individual members of ARTIST (or the individual partners of the partnership) hereby
          expressly authorise the group member (or partner){' '}
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
          </strong>{' '}
          to represent them in the context of the receipt of any declarations of will, accounts,
          payments, etc., made or served under this Agreement. Any change of address and any grant
          or revocation of letters of authority shall become binding upon the service of a
          respective written notice to MANAGEMENT.
        </p>
      </Section>

      <Section number={16} title="Final Provisions">
        {/* Adapted: confidentiality for ten (10) years (German § 16) */}
        <p>
          The Parties commit to secrecy regarding the content hereof and any information connected
          to it. MANAGEMENT further commits to keeping the economic and personal situation and
          processes of ARTIST whereof MANAGEMENT gains knowledge in the course of this Agreement
          secret from any third parties. The above obligation to confidentiality shall bind both
          Parties for a period of ten (10) years after the expiration of this Agreement.
        </p>
        <p>
          There are no oral side agreements. No modification and amendment of this Agreement shall
          be binding unless confirmed in writing. This shall also apply to any waiver of the
          requirement of written form. If and insofar as this Agreement does not stipulate
          differently in a specific case, the Parties consider written form in this Agreement to
          mean text form in the sense of § 126b German Civil Code (e.g. e-mail, fax).
        </p>
        <p>This Agreement is subject to the laws of the Federal Republic of Germany.</p>
        <p>
          The sole place of performance and place of jurisdiction is the place of MANAGEMENT’s
          registered office.
        </p>
        {/* Adapted: transfer only for internal restructuring, not to other companies (German § 16) */}
        <p>
          MANAGEMENT is entitled to transfer this Agreement as a whole or in parts for the purpose
          of internal corporate restructuring, but not to sell it to third-party companies.
        </p>
        <p>
          If any provision of this Agreement is or becomes invalid, this shall not affect the
          validity of the remaining Agreement. This applies to contractual gaps accordingly.
        </p>
      </Section>

      {c.specialClauses.trim() && (
        <Section number={17} title="Special Agreements">
          <p className="whitespace-pre-wrap">{c.specialClauses}</p>
        </Section>
      )}

      {/* Signatures: each side's place with a blank date, never split */}
      <div className="mt-12 flex break-before-avoid break-inside-avoid text-[10pt]">
        <div className="w-1/2 pr-8">
          <div>{management?.city || '____________'}, on ____________</div>
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
          <div>{artist?.city || '____________'}, on ____________</div>
          <div className="mt-2 h-[15mm]" />
          <div className="mt-2 w-4/5 border-t-2 border-black pt-1">
            ARTIST
            <div>{artist?.name ?? artistName}</div>
          </div>
        </div>
      </div>
    </PagedDocument>
  )
}
