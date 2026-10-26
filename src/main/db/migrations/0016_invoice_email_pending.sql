CREATE TABLE `invoice_email_pending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`to` text DEFAULT '' NOT NULL,
	`mail_account_id` text NOT NULL,
	`send_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_email_pending_send_key_idx` ON `invoice_email_pending` (`send_key`);