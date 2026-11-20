PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event_step_done` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`step` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_step_done_step_check" CHECK("step" IN ('contract', 'deposit', 'invoice', 'hotel', 'advancing', 'tickets', 'settlement'))
);
--> statement-breakpoint
INSERT INTO `__new_event_step_done`("id", "deal_memo_id", "step", "created_at") SELECT "id", "deal_memo_id", "step", "created_at" FROM `event_step_done`;--> statement-breakpoint
DROP TABLE `event_step_done`;--> statement-breakpoint
ALTER TABLE `__new_event_step_done` RENAME TO `event_step_done`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `event_step_done_event_step_idx` ON `event_step_done` (`deal_memo_id`,`step`);