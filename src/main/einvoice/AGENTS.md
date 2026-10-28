# src/main/einvoice - ZUGFeRD / Factur-X / XRechnung

**Score:** 9 (distinct domain: EN 16931 rules and the only money rounding)

## OVERVIEW
Builds the e-invoice of an invoice: completeness check, CII XML, PDF/A-3
embedding. Pure except `facturx.ts`/`srgbIcc.ts`, so the invoice form runs the
same check live in the renderer.

## WHERE TO LOOK
| Task | Location |
|---|---|
| Any money arithmetic | `amounts.ts` - the only rounding place in the app |
| Tax codes, VAT categories, units, VATEX | `codes.ts` |
| "What is missing" check + prepared data | `prepare.ts` (`prepareEInvoice`) |
| CII D16B XML | `cii.ts` (`buildCiiXml`) |
| Embed/read XML in the invoice PDF | `facturx.ts` (pdf-lib) |
| sRGB ICC profile bytes | `srgbIcc.ts` |
| `InvoicePrintDto` -> `EInvoiceInput` | `input.ts` (`eInvoiceInputOf`) |

## CONVENTIONS
- Check first, write second: `prepareEInvoice` returns prepared data or the German
  list "Für die E-Rechnung fehlt: ...". `buildCiiXml` only serializes. A new field
  is added to the check before the XML.
- Amounts are integer cents: line net = quantity x unit price, VAT once per rate,
  totals summed from cents. Stored totals that disagree with the recomputed ones
  block the XML instead of contradicting the printed PDF.
- Tax/VAT mapping lives only in `codes.ts` (VAT categories S/Z/E/AE/K/G/O,
  UN/ECE Rec 20 units, EU membership, exemption reasons). Reverse charge to a
  non-EU buyer is refused.
- `amounts.ts` and `codes.ts` are imported by the renderer
  (`InvoiceForm`, `InvoiceDocument`, `lib/invoiceLabels.ts`) - keep them free of
  Node and DOM APIs.
- Drafts and cancelled invoices never get an XML; `EInvoiceService.check` reports
  `disabled`/`cancelled`/`missing` states.
- Only `facturx.ts` and `srgbIcc.ts` may use pdf-lib.

## ANTI-PATTERNS
- A second amount helper in this folder: `toCents`/`fromCents`/`roundMoney` from
  `amounts.ts` are the whole API, and `cii.ts`/`prepare.ts` must not recompute.
- Emitting XML for a draft, a cancelled invoice or incomplete data.
- Re-deriving a tax category, unit code or country code inline instead of
  `codes.ts`.
- Adding a Node/DOM import to `amounts.ts`, `codes.ts`, `prepare.ts`, `cii.ts` or
  `input.ts`: the renderer bundle breaks.

## COMMANDS
```bash
pnpm test                       # tests/einvoice.test.ts
pnpm validate:einvoice          # KoSIT + veraPDF (downloads pinned tools, needs Java 11+)
```
