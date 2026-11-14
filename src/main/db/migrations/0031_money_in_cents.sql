ALTER TABLE `deal_memo` ADD `ticket_price_vvk_cents` integer;--> statement-breakpoint
ALTER TABLE `deal_memo` ADD `ticket_price_ak_cents` integer;--> statement-breakpoint
ALTER TABLE `deal_memo` ADD `guarantee_cents` integer;--> statement-breakpoint
ALTER TABLE `deal_memo_deposit` ADD `amount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `subtotal_net_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `subtotal_tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `total_gross_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `line_net_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `line_tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `line_gross_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `management_share_income` ADD `net_cents` integer DEFAULT 0 NOT NULL;