# Going live with DATEV

The runbook for the day Bookingium takes over writing invoices and creating customers from
DATEV Unternehmen online (DUO). Until then DATEV keeps writing invoices; afterwards DATEV only
receives the finished documents by DATEV Upload Mail. How the parts work: `docs/ARCHITECTURE.md`
› DATEV (Upload Mail).

The principle: **one place issues each number range.** Invoice numbers continue DATEV's last
one and are only issued by Bookingium from the switch date on; customer numbers are taken over
from DATEV once and then made by Bookingium.

## Before the switch date

- [ ] DUO › Upload Mail: note the client's (Mandant) upload addresses. DATEV gives one per
      document category (Rechnungsausgang, Rechnungseingang, Kasse, Sonstige,
      Kreditkartenbelege); invoices from Bookingium go to Rechnungsausgang.
- [ ] DUO › Upload Mail: confirm the sending address of Einstellungen › E-Mail › „Senden von“
      (one-time, with SmartLogin).
- [ ] Find out whether the running part of the invoice number restarts at 1 each year or
      continues (2026812 → 2027001 or 2027813).
- [ ] Export the customer list (customers / debtors with their numbers) from DATEV as CSV or Excel.

## On the switch date

- [ ] Import the customers with their Kundennummer (the import still has to learn that column).
- [ ] Einstellungen › Rechnungen › Rechnungsnummerierung: the format, the next number = DATEV's
      last + 1, and the yearly restart as found out above. The preview shows the next number.
- [ ] Einstellungen › Rechnungen › Kundennummern: the next number after the highest imported one
      (numbers already taken are skipped anyway).
- [ ] Einstellungen › Rechnungen › DATEV: per issuing company at least the Rechnungsausgang
      address, the other categories when documents of those kinds will go there.
- [ ] The issuing company: logo uploaded, legal data complete (register, tax numbers, bank); the
      Geschäftsbrief footer prints them.
- [ ] Stop writing outgoing invoices in DATEV.
- [ ] First invoice: issue it, „An DATEV übergeben“, check it arrives in DUO in the right
      category. The Dashboard card „Noch nicht an DATEV übergeben“ is empty afterwards.

## Afterwards

- Wrong invoice: never edit or delete it, cancel it (Stornieren). The Stornorechnung takes the
  next number and both go to DATEV.
- An invoice cannot be issued with a date before the last issued one; move the date on instead.
