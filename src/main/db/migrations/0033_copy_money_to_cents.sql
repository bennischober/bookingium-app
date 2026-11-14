-- #150: money as integer cents (the euro columns are dropped by the next migration).
-- The inner ROUND(.., 6) drops float noise first (1.005 * 100 is 100.49999999999999),
-- like toCents in einvoice/amounts.ts; ROUND then halves away from zero, negative
-- cancellation amounts included.
UPDATE `deal_memo` SET
  `ticket_price_vvk_cents` = CAST(ROUND(ROUND(`ticket_price_vvk` * 100, 6)) AS INTEGER),
  `ticket_price_ak_cents` = CAST(ROUND(ROUND(`ticket_price_ak` * 100, 6)) AS INTEGER),
  `guarantee_cents` = CAST(ROUND(ROUND(`guarantee_amount` * 100, 6)) AS INTEGER);
--> statement-breakpoint
UPDATE `deal_memo_deposit` SET `amount_cents` = CAST(ROUND(ROUND(`amount` * 100, 6)) AS INTEGER);
--> statement-breakpoint
UPDATE `invoice` SET
  `subtotal_net_cents` = CAST(ROUND(ROUND(`subtotal_net_amount` * 100, 6)) AS INTEGER),
  `subtotal_tax_cents` = CAST(ROUND(ROUND(`subtotal_tax_amount` * 100, 6)) AS INTEGER),
  `total_gross_cents` = CAST(ROUND(ROUND(`total_gross_amount` * 100, 6)) AS INTEGER);
--> statement-breakpoint
UPDATE `invoice_line_item` SET
  `line_net_cents` = CAST(ROUND(ROUND(`line_net_amount` * 100, 6)) AS INTEGER),
  `line_tax_cents` = CAST(ROUND(ROUND(`line_tax_amount` * 100, 6)) AS INTEGER),
  `line_gross_cents` = CAST(ROUND(ROUND(`line_gross_amount` * 100, 6)) AS INTEGER);
--> statement-breakpoint
UPDATE `management_share_income` SET
  `net_cents` = CAST(ROUND(ROUND(`net_amount` * 100, 6)) AS INTEGER);
