CREATE TABLE `appointment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`start_time` text,
	`end_date` text NOT NULL,
	`end_time` text,
	`place` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`reminder_minutes` integer,
	`reminded_at` text,
	`event_id` integer,
	`band_id` integer,
	`venue_id` integer,
	`company_id` integer,
	`person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `appointment_start_idx` ON `appointment` (`start_date`);--> statement-breakpoint
CREATE INDEX `appointment_event_idx` ON `appointment` (`event_id`);--> statement-breakpoint
CREATE INDEX `appointment_band_idx` ON `appointment` (`band_id`);--> statement-breakpoint
CREATE INDEX `appointment_venue_idx` ON `appointment` (`venue_id`);--> statement-breakpoint
CREATE INDEX `appointment_company_idx` ON `appointment` (`company_id`);--> statement-breakpoint
CREATE INDEX `appointment_person_idx` ON `appointment` (`person_id`);