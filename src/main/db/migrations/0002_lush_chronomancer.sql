ALTER TABLE `company` ADD `signature_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company` ADD `ksk_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_memo` ADD `guarantee_amount` real;--> statement-breakpoint
ALTER TABLE `deal_memo` ADD `guarantee_vat_rate` real;--> statement-breakpoint
ALTER TABLE `deal_memo` ADD `contract_notes` text DEFAULT '';