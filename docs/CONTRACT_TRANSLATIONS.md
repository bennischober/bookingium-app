# English contracts: sources and passages to review

The English contracts are worded from legally reviewed English templates the user provided
(kept outside git). Nothing on a printed contract points to where a template came from: the
templates' parties, agencies, addresses, places of jurisdiction and deal-specific numbers are
left out, and the code and docs describe the templates only by kind.

In the code, every passage carries a `Template:`, `Adapted:` or `Translated:` comment:

- **Template**: the template's wording, with the parties' data filled in.
- **Adapted**: a template clause whose fixed value gave way to the German contract's
  (a number, a period) or to data from the app.
- **Translated**: a German clause with no template counterpart, translated for this app. These
  are not lawyer-reviewed and should be checked before use.

A change to a German clause needs a look at the English version.

## Management agreement (`ManagementContractDocumentEn.tsx`)

Source: the English model management agreement (2016), whose German twin the German contract
is based on. Same sections and numbering as the German contract. Where the model offers
alternatives, the English version uses the German contract's choice: power of attorney per
case (§ 6), accounting by the ARTIST (§ 9), group clause covering each member individually
(§ 15). Left out because the German contract does not have them: the conflict-of-interest
paragraph, earnings of third-party entities, the audit clause, deduction of expenses, the
notices paragraph, and the § 627 BGB addendum.

Where the German contract keeps the German model's wording, the English model's counterpart is
used, including § 5's delegation sentence (costs of third parties need the ARTIST's approval).

Adapted where the German contract differs from the German model (check these):

| §   | Passage            | Change against the model                                                                                                            |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Activities         | "musician, composer and lyricist" only (model: also producer, DJ, host, actor)                                                      |
| 2   | Territory          | stored German values read as English ("örtlich unbeschränkt" → "without restrictions as to territory"); other values print as typed |
| 7   | Delegation         | adds "this shall be done in consultation with ARTIST"                                                                               |
| 8   | Earnings           | no separate "neighbouring rights" item; sentence for excluded income; "only earnings generated under the name …"                    |
| 9   | Accounting         | quarterly instead of monthly; objection within one month instead of twelve                                                          |
| 13  | Sunset clause      | percentages from the contract; no sentence on the fourth year; "including by way of follow-up agreements"                           |
| 16  | Final provisions   | confidentiality for ten (10) years; transfer only for internal restructuring, not to other companies                                |
| 17  | Special agreements | free text as typed in the app (usually German)                                                                                      |

## Concert contract (`ContractDocumentEn.tsx`)

Sources: an English "Concert Performance Agreement" (title, parties with Artist, Promoter and
Agent, the deal sheet, the general terms) and a shorter English guest appearance contract
(tickets and show costs, helpers, the stage "firmly fixed", open-air protection, set-up and
dressing room, merchandise). Its layout follows the first template, not the German contract's
numbering: a deal sheet with the event's data (show, schedule, deal, terms of payment,
production, guest list), then numbered general terms, then the special agreements.

From the templates, unchanged apart from the parties' names: rider, PA/lights/stage,
hospitality/catering, parking/vehicles, staff, permits and collecting societies, tickets/show
costs, security/safety with set-up and dressing room, promotion, merchandise, payments/
settlement, presentation/performance, concert failure/cancellation with force majeure,
filming/broadcasting/streaming, taxes with the withholding-tax certificate, injury/property
damage, sponsoring, miscellaneous (German law, written form, severability, no ordinary
termination by the Promoter, confidentiality).

Left out of the templates: their parties and agencies, the place of jurisdiction, the fixed
penalty per vehicle without parking, fixed numbers (catering for 30 people, a 10 × 8 m stage,
four helpers), ground transport and visas.

Adapted (check these):

- "e.g. GEMA in Germany" added to the collecting-society clause
- Guest list: at least 10 (ten) people, as in the German contract
- Helpers: at least two (2), as in the German contract
- Accommodation: number of persons, rooms and hotel from the event
- Backline: "Provided by Artist", as in the German contract

Translated from the German contract, collected under **Additional Terms** (check all of these):

- Late advance payment: only the Artist may withdraw; claims for damages remain
- Disclosure if the Promoter is a party or association; Promoter's sponsors need written
  agreement; no advertising in the stage area; backdrop 4 m × 3 m
- Merchandise stand when there is no central seller (two tables, chair, 220 V, within 30 m)
- Further guest list places for promoters, labels, media and endorsement partners
- No weapons; sign about the risk to hearing; no liability for consequential damage
- Release for a film, radio or TV engagement known only after signing
- Return of the signed contract within two weeks; deemed accepted after 21 days

Dropped against the German contract, because the templates cover the subject differently or it
only applies in Germany: the KSK clause and KSK number, the Artist's liability limited under
§ 823 (1) BGB (the template's indemnity applies instead), the contractual penalty in the
amount of the fee on cancellation (the template's full payment obligation applies instead),
directions eight days before the show, and the correspondence address.

Free text from the event (deal, programme notes, room information, special agreements) prints
as typed in the app.
