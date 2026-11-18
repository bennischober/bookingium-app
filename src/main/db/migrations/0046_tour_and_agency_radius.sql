ALTER TABLE `deal_memo` ADD `tour` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `deal_memo_tour_idx` ON `deal_memo` (`tour`);--> statement-breakpoint
ALTER TABLE `external_booking` ADD `radius_km` integer;--> statement-breakpoint
ALTER TABLE `external_booking` ADD `radius_weeks_before` integer;--> statement-breakpoint
ALTER TABLE `external_booking` ADD `radius_weeks_after` integer;