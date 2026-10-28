CREATE TABLE `contact_email` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`email` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_email_email_idx` ON `contact_email` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_email_contact_email_idx` ON `contact_email` (`contact_id`,`email`);