CREATE TABLE `band_agreement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`kind` text NOT NULL,
	`company_id` integer,
	`start_date` text,
	`terms` text DEFAULT '{}' NOT NULL,
	`special_clauses` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "band_agreement_kind_check" CHECK("kind" IN ('publishing', 'label'))
);
--> statement-breakpoint
CREATE INDEX `band_agreement_band_idx` ON `band_agreement` (`band_id`);