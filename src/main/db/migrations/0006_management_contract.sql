CREATE TABLE `management_contract` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`management_company_id` integer,
	`start_date` text,
	`territory` text DEFAULT 'örtlich unbeschränkt' NOT NULL,
	`term_years` integer DEFAULT 3 NOT NULL,
	`renewal_years` integer DEFAULT 1 NOT NULL,
	`notice_months` integer DEFAULT 6 NOT NULL,
	`commission_percent` real DEFAULT 20 NOT NULL,
	`excluded_income` text DEFAULT 'GVL und GEMA Einnahmen' NOT NULL,
	`statement_email` text DEFAULT '' NOT NULL,
	`settlement_days` integer DEFAULT 30 NOT NULL,
	`payment_days` integer DEFAULT 14 NOT NULL,
	`post_term_year1_percent` real DEFAULT 30 NOT NULL,
	`post_term_year2_percent` real DEFAULT 0 NOT NULL,
	`post_term_year3_percent` real DEFAULT 0 NOT NULL,
	`representative_person_id` integer,
	`special_clauses` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`management_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`representative_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `management_contract_band_idx` ON `management_contract` (`band_id`);--> statement-breakpoint
CREATE TABLE `management_contract_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `management_contract`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_contract_member_unique_idx` ON `management_contract_member` (`contract_id`,`person_id`);