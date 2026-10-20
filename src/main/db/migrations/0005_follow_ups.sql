CREATE TABLE `follow_up` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`due_date` text NOT NULL,
	`note` text NOT NULL,
	`done_at` text,
	`event_id` integer,
	`band_id` integer,
	`venue_id` integer,
	`company_id` integer,
	`person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `follow_up_open_idx` ON `follow_up` (`done_at`,`due_date`);--> statement-breakpoint
CREATE INDEX `follow_up_event_idx` ON `follow_up` (`event_id`);--> statement-breakpoint
CREATE INDEX `follow_up_band_idx` ON `follow_up` (`band_id`);--> statement-breakpoint
CREATE INDEX `follow_up_venue_idx` ON `follow_up` (`venue_id`);--> statement-breakpoint
CREATE INDEX `follow_up_company_idx` ON `follow_up` (`company_id`);--> statement-breakpoint
CREATE INDEX `follow_up_person_idx` ON `follow_up` (`person_id`);