PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_external_booking` (
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
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_booking_kind_check" CHECK("kind" IN ('venue', 'festival')),
	CONSTRAINT "external_booking_status_check" CHECK("status" IN ('confirmed', 'pending', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_external_booking`("id", "band_id", "date", "kind", "status", "venue_name", "street", "zip_code", "city", "country", "notes", "agency", "source_key", "source_file", "imported_at", "created_at", "updated_at") SELECT "id", "band_id", "date", "kind", "status", "venue_name", "street", "zip_code", "city", "country", "notes", "agency", "source_key", "source_file", "imported_at", "created_at", "updated_at" FROM `external_booking`;--> statement-breakpoint
DROP TABLE `external_booking`;--> statement-breakpoint
ALTER TABLE `__new_external_booking` RENAME TO `external_booking`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `external_booking_date_idx` ON `external_booking` (`date`);--> statement-breakpoint
CREATE INDEX `external_booking_band_idx` ON `external_booking` (`band_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_booking_source_idx` ON `external_booking` (`agency`,`source_key`);