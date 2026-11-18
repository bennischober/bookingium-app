CREATE TABLE `event_settlement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`data` text NOT NULL,
	`source_file_name` text DEFAULT '' NOT NULL,
	`fee_invoice_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fee_invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_settlement_event_idx` ON `event_settlement` (`deal_memo_id`);--> statement-breakpoint
ALTER TABLE `management_contract` ADD `agency_percent` real DEFAULT 15 NOT NULL;