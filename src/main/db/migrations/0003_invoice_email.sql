ALTER TABLE `invoice` ADD `emailed_at` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `emailed_to` text DEFAULT '' NOT NULL;