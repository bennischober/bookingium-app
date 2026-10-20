CREATE TABLE `contact_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `contact` ADD `no_advertising` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `venue` ADD `genres` text DEFAULT '' NOT NULL;