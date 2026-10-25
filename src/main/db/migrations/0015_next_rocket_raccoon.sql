ALTER TABLE `deal_memo` ADD `archived_at` text;--> statement-breakpoint
CREATE INDEX `deal_memo_archived_idx` ON `deal_memo` (`archived_at`);
