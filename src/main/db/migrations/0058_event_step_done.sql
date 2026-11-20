CREATE TABLE `event_step_done` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`step` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_step_done_step_check" CHECK("step" IN ('contract', 'deposit', 'invoice', 'hotel', 'advancing', 'tickets'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_step_done_event_step_idx` ON `event_step_done` (`deal_memo_id`,`step`);