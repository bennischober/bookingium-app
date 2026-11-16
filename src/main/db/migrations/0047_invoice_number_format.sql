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
CREATE INDEX `company_invoice_settings_next_number_idx` ON `company_invoice_settings` (`next_invoice_number`);