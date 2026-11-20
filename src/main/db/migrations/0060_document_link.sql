CREATE TABLE `document_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`deal_memo_id` integer,
	`band_id` integer,
	`company_id` integer,
	`venue_id` integer,
	`person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `document`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_link_one_record" CHECK(("document_link"."deal_memo_id" IS NOT NULL) + ("document_link"."band_id" IS NOT NULL) + ("document_link"."company_id" IS NOT NULL) + ("document_link"."venue_id" IS NOT NULL) + ("document_link"."person_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_link_event_idx` ON `document_link` (`document_id`,`deal_memo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_link_band_idx` ON `document_link` (`document_id`,`band_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_link_company_idx` ON `document_link` (`document_id`,`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_link_venue_idx` ON `document_link` (`document_id`,`venue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_link_person_idx` ON `document_link` (`document_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `document_link_deal_memo_id_idx` ON `document_link` (`deal_memo_id`);--> statement-breakpoint
CREATE INDEX `document_link_band_id_idx` ON `document_link` (`band_id`);--> statement-breakpoint
CREATE INDEX `document_link_company_id_idx` ON `document_link` (`company_id`);--> statement-breakpoint
CREATE INDEX `document_link_venue_id_idx` ON `document_link` (`venue_id`);--> statement-breakpoint
CREATE INDEX `document_link_person_id_idx` ON `document_link` (`person_id`);