CREATE TABLE `invoice_email` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`to` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_email_invoice_idx` ON `invoice_email` (`invoice_id`);--> statement-breakpoint
-- The one email each invoice remembered so far starts its history
INSERT INTO `invoice_email` (`invoice_id`, `to`, `created_at`)
SELECT `id`, `emailed_to`, `emailed_at` FROM `invoice` WHERE `emailed_at` IS NOT NULL;