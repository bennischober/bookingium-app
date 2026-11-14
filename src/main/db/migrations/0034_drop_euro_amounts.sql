ALTER TABLE `deal_memo` DROP COLUMN `ticket_price_vvk`;--> statement-breakpoint
ALTER TABLE `deal_memo` DROP COLUMN `ticket_price_ak`;--> statement-breakpoint
ALTER TABLE `deal_memo` DROP COLUMN `guarantee_amount`;--> statement-breakpoint
ALTER TABLE `deal_memo_deposit` DROP COLUMN `amount`;--> statement-breakpoint
ALTER TABLE `invoice` DROP COLUMN `subtotal_net_amount`;--> statement-breakpoint
ALTER TABLE `invoice` DROP COLUMN `subtotal_tax_amount`;--> statement-breakpoint
ALTER TABLE `invoice` DROP COLUMN `total_gross_amount`;--> statement-breakpoint
ALTER TABLE `invoice` DROP COLUMN `total_amount`;--> statement-breakpoint
ALTER TABLE `invoice_line_item` DROP COLUMN `line_net_amount`;--> statement-breakpoint
ALTER TABLE `invoice_line_item` DROP COLUMN `line_tax_amount`;--> statement-breakpoint
ALTER TABLE `invoice_line_item` DROP COLUMN `line_gross_amount`;--> statement-breakpoint
ALTER TABLE `management_share_income` DROP COLUMN `net_amount`;