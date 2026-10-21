CREATE TABLE `invoice_status_change` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_status_change_invoice_idx` ON `invoice_status_change` (`invoice_id`);--> statement-breakpoint
INSERT INTO `invoice_status_change` (`invoice_id`, `status`, `created_at`) SELECT `id`, 'issued', `issue_date` FROM `invoice` WHERE `status` <> 'draft';--> statement-breakpoint
INSERT INTO `invoice_status_change` (`invoice_id`, `status`, `created_at`) SELECT `id`, `status`, coalesce(`updated_at`, `created_at`) FROM `invoice` WHERE `status` IN ('paid', 'overdue', 'cancelled');
