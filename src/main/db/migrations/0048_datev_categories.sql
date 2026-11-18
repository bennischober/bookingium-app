ALTER TABLE `company_invoice_settings` ADD `datev_upload_email_incoming` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company_invoice_settings` ADD `datev_upload_email_cash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company_invoice_settings` ADD `datev_upload_email_other` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company_invoice_settings` ADD `datev_upload_email_credit_card` text DEFAULT '' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_datev_transfer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`category` text DEFAULT 'outgoing' NOT NULL,
	`to` text NOT NULL,
	`file_name` text NOT NULL,
	`mail_account_id` text NOT NULL,
	`send_key` text NOT NULL,
	`message_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "datev_transfer_status_check" CHECK("status" IN ('pending', 'sent')),
	CONSTRAINT "datev_transfer_category_check" CHECK("category" IN ('outgoing', 'incoming', 'cash', 'other', 'credit_card'))
);
--> statement-breakpoint
INSERT INTO `__new_datev_transfer`("id", "invoice_id", "status", "to", "file_name", "mail_account_id", "send_key", "message_id", "created_at", "sent_at") SELECT "id", "invoice_id", "status", "to", "file_name", "mail_account_id", "send_key", "message_id", "created_at", "sent_at" FROM `datev_transfer`;--> statement-breakpoint
DROP TABLE `datev_transfer`;--> statement-breakpoint
ALTER TABLE `__new_datev_transfer` RENAME TO `datev_transfer`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `datev_transfer_invoice_idx` ON `datev_transfer` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `datev_transfer_send_key_idx` ON `datev_transfer` (`send_key`);