CREATE TABLE `contact_list_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_list_id` integer NOT NULL,
	`person_id` integer,
	`company_id` integer,
	`venue_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_list_id`) REFERENCES `contact_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_list_member_one_record" CHECK(("contact_list_member"."person_id" IS NOT NULL) + ("contact_list_member"."company_id" IS NOT NULL) + ("contact_list_member"."venue_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_list_member_person_idx` ON `contact_list_member` (`contact_list_id`,`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_list_member_company_idx` ON `contact_list_member` (`contact_list_id`,`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_list_member_venue_idx` ON `contact_list_member` (`contact_list_id`,`venue_id`);--> statement-breakpoint
CREATE INDEX `contact_list_member_person_id_idx` ON `contact_list_member` (`person_id`);--> statement-breakpoint
CREATE INDEX `contact_list_member_company_id_idx` ON `contact_list_member` (`company_id`);--> statement-breakpoint
CREATE INDEX `contact_list_member_venue_id_idx` ON `contact_list_member` (`venue_id`);--> statement-breakpoint
ALTER TABLE `contact_list` ADD `kind` text DEFAULT 'filter' NOT NULL;