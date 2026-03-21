# Lists of TODOs and future improvements for the app

- The previous step also requires us to implement the PDF creation logic, e.g. for invoices, contracts, and so on. It was suggested to just use React components for this and use the print-to-PDF functionality of the browser, which is a good idea to keep things simple and avoid adding a heavy PDF generation library. We can create a hidden React component that renders the invoice/contract in a print-friendly format, and when the user clicks "Download PDF", we can trigger the print dialog for that component.
- Implement all missing pages, e.g. the `Venues`, `Hotels`, and `Calendar` pages.

Remarks: at some point we might want to check that we use the same coding guidelines and patterns everywhere, e.g. some repositories use create and update, whereas others use upsert. We also need to check if we split up larger components and so on. But this is something for later.
