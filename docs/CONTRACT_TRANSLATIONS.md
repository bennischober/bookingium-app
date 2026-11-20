# English contracts: sources and passages to review

The English contracts print the same sections, numbering and data as the German ones.
Their wording comes from two sources:

- **Template**: the English templates the user provided (kept outside git in
  `sample_data/contract-templates/`): the English VUT management agreement sample (2016) and
  an English booking contract ("Guest Appearance Contract") from another agency.
- **Translated**: passages of the German contract with no matching clause in the template,
  translated for this app. These are not lawyer-reviewed and should be checked before use.

In the code, every adapted or translated passage carries an `Adapted:`, `Template:` or
`Translated:` comment. A change to a German clause needs the same change in its English twin.

## Management agreement (`ManagementContractDocumentEn.tsx`)

Wording from the VUT sample. Where the sample offers alternatives, the English version uses
the same option as the German contract: power of attorney per case (§ 6), accounting by the
ARTIST (§ 9), group clause covering each member individually (§ 15). Left out because the
German contract does not have them: the conflict-of-interest paragraph, earnings of
third-party entities, the audit clause, deduction of expenses, the notices paragraph, and the
§ 627 BGB addendum.

Adapted to match the German contract (check these):

| §   | Passage            | Change against the VUT sample                                                                                                       |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Activities         | "musician, composer and lyricist" only (sample: also producer, DJ, host, actor)                                                     |
| 2   | Territory          | stored German values read as English ("örtlich unbeschränkt" → "without restrictions as to territory"); other values print as typed |
| 5   | Delegation         | only without extra costs for ARTIST or with agreed costs (sample: costs need ARTIST's approval)                                     |
| 7   | Delegation         | adds "this shall be done in consultation with ARTIST"                                                                               |
| 8   | Earnings           | no separate "neighbouring rights" item; sentence for excluded income; "only earnings generated under the name …"                    |
| 9   | Accounting         | quarterly instead of monthly; objection within one month instead of twelve                                                          |
| 13  | Sunset clause      | percentages from the contract; no sentence on the fourth year; "including by way of follow-up agreements"                           |
| 16  | Final provisions   | confidentiality for ten (10) years; transfer only for internal restructuring, not to other companies                                |
| 17  | Special agreements | free text as typed in the app (usually German)                                                                                      |

## Concert contract (`ContractDocumentEn.tsx`)

Structure of the German Konzertvertrag. From the template: the title, "on behalf and on
account of", the opening sentence, the guarantee sentence (§ 2 of the template), overnight
accommodation (§ 4), helpers carrying the backline (§ 10), the stage "firmly fixed" (§ 11),
numbered tickets and costs that cannot be evidenced (§§ 2, 7), changes in writing (§ 23),
"act of God" (§ 22), "Signature/Stamp". The template's agency details (name, address, place
of jurisdiction, fixed numbers such as catering for 30 people or a 10 × 8 m stage) are not
used.

Translated from the German contract (check all of these):

- Parties: "Contracting Party 1 (CP1)" / "Contracting Party 2 (CP2)" for VP1/VP2; the KSK
  number line
- Engagement, Fee (apart from the guarantee sentence), Accounting, Advance Payment
- Registrations, GEMA, KSK and Taxes
- Technical Equipment / Personnel, Stage (roofed stage, horizontally even surface)
- Arrival / Access / Parking, Accommodation (with breakfast), Catering, Artistic Freedom
- Associations, Sponsoring, Presentation; Organisation and Security (incl. liability under
  § 823 (1) BGB)
- Advertising
- Cancellation: "Vertragsstrafe" kept as **contractual penalty** (the template's "liquidated
  damage" is a different legal concept); "weitergehender Schaden" as "further damage"
- Merchandising, Recordings, Guest List, Stage Rider, Legal Relationship, General Provisions
- Free text from the event (deal, programme notes, room information, special agreements)
  prints as typed in the app
