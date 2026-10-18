CREATE TABLE `management_share` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`band_id` integer NOT NULL,
	`management_contract_id` integer,
	`year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`commission_percent` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`management_contract_id`) REFERENCES `management_contract`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_share_invoice_unique_idx` ON `management_share` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `management_share_band_period_idx` ON `management_share` (`band_id`,`year`,`quarter`);--> statement-breakpoint
CREATE TABLE `management_share_income` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_id` integer NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`net_amount` real NOT NULL,
	FOREIGN KEY (`share_id`) REFERENCES `management_share`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `management_share_income_share_idx` ON `management_share_income` (`share_id`);