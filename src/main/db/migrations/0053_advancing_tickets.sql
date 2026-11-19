CREATE TABLE `event_advancing` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`status_date` text,
	`local_contact_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`local_contact_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "event_advancing_status_check" CHECK("status" IN ('open', 'contacted', 'in_progress', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_advancing_event_idx` ON `event_advancing` (`deal_memo_id`);--> statement-breakpoint
CREATE INDEX `event_advancing_contact_idx` ON `event_advancing` (`local_contact_id`);--> statement-breakpoint
CREATE TABLE `event_ticket_quota` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`quota` integer,
	`quota_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_ticket_quota_event_idx` ON `event_ticket_quota` (`deal_memo_id`);--> statement-breakpoint
CREATE TABLE `ticket_report` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`report_date` text NOT NULL,
	`sold` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_report_event_day_idx` ON `ticket_report` (`deal_memo_id`,`report_date`);