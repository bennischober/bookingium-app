CREATE TABLE `datev_transfer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`to` text NOT NULL,
	`file_name` text NOT NULL,
	`mail_account_id` text NOT NULL,
	`send_key` text NOT NULL,
	`message_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "datev_transfer_status_check" CHECK("status" IN ('pending', 'sent'))
);
--> statement-breakpoint
CREATE INDEX `datev_transfer_invoice_idx` ON `datev_transfer` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `datev_transfer_send_key_idx` ON `datev_transfer` (`send_key`);--> statement-breakpoint
ALTER TABLE `company_invoice_settings` ADD `datev_upload_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_company_invoice_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`next_invoice_number` integer DEFAULT 1 NOT NULL,
	`invoice_number_format` text DEFAULT 'plain' NOT NULL,
	`invoice_number_digits` integer DEFAULT 3 NOT NULL,
	`invoice_number_yearly_reset` integer DEFAULT false NOT NULL,
	`invoice_number_year` integer,
	`datev_upload_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "company_invoice_settings_number_format_check" CHECK("invoice_number_format" IN ('plain', 'year')),
	CONSTRAINT "company_invoice_settings_number_digits_check" CHECK("invoice_number_digits" BETWEEN 1 AND 9)
);
--> statement-breakpoint
INSERT INTO `__new_company_invoice_settings`("id", "company_id", "next_invoice_number", "datev_upload_email", "created_at", "updated_at") SELECT "id", "company_id", "next_invoice_number", "datev_upload_email", "created_at", "updated_at" FROM `company_invoice_settings`;--> statement-breakpoint
DROP TABLE `company_invoice_settings`;--> statement-breakpoint
ALTER TABLE `__new_company_invoice_settings` RENAME TO `company_invoice_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `company_invoice_settings_company_unique_idx` ON `company_invoice_settings` (`company_id`);--> statement-breakpoint
CREATE INDEX `company_invoice_settings_next_number_idx` ON `company_invoice_settings` (`next_invoice_number`);--> statement-breakpoint
ALTER TABLE `band` ADD `customer_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `band_customer_number_idx` ON `band` (`customer_number`);--> statement-breakpoint
ALTER TABLE `company` ADD `customer_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `company_customer_number_idx` ON `company` (`customer_number`);--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `customer_number` integer;--> statement-breakpoint
ALTER TABLE `person` ADD `customer_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `person_customer_number_idx` ON `person` (`customer_number`);