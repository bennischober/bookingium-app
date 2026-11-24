CREATE TABLE `calendar_subscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`color` text DEFAULT '#0ea5e9' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_subscription_cache` (
	`subscription_id` integer PRIMARY KEY NOT NULL,
	`ics` text DEFAULT '' NOT NULL,
	`fetched_at` text,
	`attempted_at` text,
	`error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `calendar_subscription`(`id`) ON UPDATE no action ON DELETE cascade
);
