ALTER TABLE `company` ADD `tax_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company` ADD `commercial_register_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company` ADD `register_court` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `tax_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `commercial_register_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `register_court` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `account_holder` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `bank_name` text DEFAULT '' NOT NULL;