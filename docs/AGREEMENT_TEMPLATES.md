# Publishing and label agreements: sources and passages to review

A band has, besides its management contracts, **publishing contracts** and **label
agreements** (band page › Geld). One table holds both (`band_agreement`): the band, the kind,
the counterparty company (publisher or label), the start date, the special agreements and the
terms as JSON per kind (`band_agreement.schema.ts`, every missing field at its default, so a
new option of a template needs no migration). A new agreement copies the band's latest of the
same kind. They print in German or English (`/band-agreements/$agreementId/print`); there is no
contract email for them yet. Employees see only the ones they created (`staff/policy.ts`).

The legal text comes from blank templates the user provided (kept outside git). Nothing on a
printed agreement points to where a template came from.

## Publishing contract (`PublishingAgreementDocument.tsx`)

Source: the model publishing agreement (2016), which comes in German and English, both legally
reviewed. Both languages are printed word for word, paragraph by paragraph. The record picks
the model's alternatives (rights for the statutory protection period or for N years; unknown
types of use paid in proportion or agreed later at market terms) and fills its blanks (GEMA
number, publisher name, print percentages, statement email, confidentiality years, bank
account of the band company). Annex A lists the works; annex B (exclusive term, options,
loan payment, option advance, rolling advance, minimum delivery, refund) prints only for an
exclusive contract, each part only when its value is set.

Changed against the model (check these):

- Typing errors corrected in both languages; the German audit clause says "zuungunsten des
  AUTORS" (the model: "des LIZENZGEBERS").
- English § 3 (print rights): "adaptations which do **not** affect the AUTHOR's moral rights",
  as in the German model ("die nicht das Urheberpersönlichkeitsrecht beeinträchtigen"); the
  English model says "which do affect".
- Cross references follow the printed numbering: the minimum term is annex B 1.2, the option
  1.3; the German reference to an "Einzeltitelautorenvertrag gemäß Ziffer 1.4" and the English
  "(see section 2.3. below)" are left out.
- Amounts print as figures ("EUR 5.000,00") without the model's amount in words.
- Minimum delivery: the model's list of named distribution companies is left out ("mit einem
  ordentlichen Vertrieb" / "with the help of a recognised distribution company").
- Not in the model: a "Sondervereinbarungen / Special Agreements" section before the
  signatures when the record has special agreements.
- The model's place names at the signatures are left out; place and date are filled in by hand.

## Label head of agreement (`LabelAgreementDocument.tsx`)

Source: an English head of agreement of a record label (legally reviewed), a sheet of terms
followed by the Owner's warranty. The template's label, band, place, date and deal numbers are
replaced by the record's parties and terms (rights, territory, title exclusivity, exploitation
time, term, album options, option advances by copies sold, physical and digital royalty tiers,
packaging deduction, sublicensing, accounting, returns reserve, free copies, prices for the
band, merchandise). The template's offers of a shop deal and a publishing deal ("via
Licensee") print only when ticked.

**The German version is a translation for this app and not lawyer-reviewed.** A German sheet
starts only when picked; the print page starts in English. Unchanged English defaults of the
free-text terms print in German on a German sheet (`GERMAN_DEFAULTS`).
