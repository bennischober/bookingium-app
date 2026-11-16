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
ALTER TABLE `company_invoice_settings` ADD `datev_upload_email` text DEFAULT '' NOT NULL;