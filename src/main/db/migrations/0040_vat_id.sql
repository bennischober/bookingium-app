ALTER TABLE `company` ADD `vat_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `vat_id` text DEFAULT '' NOT NULL;