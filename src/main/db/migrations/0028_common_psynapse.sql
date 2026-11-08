CREATE TABLE `deal_memo_deposit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`position` integer NOT NULL,
	`amount` real NOT NULL,
	`due_date` text,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deal_memo_deposit_deal_memo_idx` ON `deal_memo_deposit` (`deal_memo_id`,`position`);