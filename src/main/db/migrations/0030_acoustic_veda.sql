CREATE TABLE `external_booking` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`date` text NOT NULL,
	`kind` text DEFAULT 'venue' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`venue_name` text DEFAULT '' NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`zip_code` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`agency` text NOT NULL,
	`source_key` text NOT NULL,
	`source_file` text DEFAULT '' NOT NULL,
	`imported_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_booking_date_idx` ON `external_booking` (`date`);--> statement-breakpoint
CREATE INDEX `external_booking_band_idx` ON `external_booking` (`band_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_booking_source_idx` ON `external_booking` (`agency`,`source_key`);