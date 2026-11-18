CREATE TABLE `trip` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`person_id` integer,
	`traveller_name` text DEFAULT '' NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`destination` text DEFAULT '' NOT NULL,
	`country_code` text(2) DEFAULT 'DE' NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`overnight` integer DEFAULT true NOT NULL,
	`rate_partial_cents` integer,
	`rate_full_cents` integer,
	`kilometres` integer DEFAULT 0 NOT NULL,
	`vehicle` text DEFAULT 'car' NOT NULL,
	`meals` text DEFAULT '{}' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "trip_vehicle_check" CHECK("vehicle" IN ('car', 'other')),
	CONSTRAINT "trip_category_check" CHECK("category" IN ('outgoing', 'incoming', 'cash', 'other', 'credit_card'))
);
--> statement-breakpoint
CREATE INDEX `trip_start_idx` ON `trip` (`start_at`);--> statement-breakpoint
ALTER TABLE `receipt` ADD `trip_id` integer REFERENCES trip(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `receipt` ADD `trip_report` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `receipt_trip_idx` ON `receipt` (`trip_id`);