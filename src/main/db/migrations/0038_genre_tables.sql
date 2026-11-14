CREATE TABLE `band_genre` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genre`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `band_genre_unique_idx` ON `band_genre` (`band_id`,`genre_id`);--> statement-breakpoint
CREATE INDEX `band_genre_genre_idx` ON `band_genre` (`genre_id`);--> statement-breakpoint
CREATE TABLE `company_genre` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genre`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_genre_unique_idx` ON `company_genre` (`company_id`,`genre_id`);--> statement-breakpoint
CREATE INDEX `company_genre_genre_idx` ON `company_genre` (`genre_id`);--> statement-breakpoint
CREATE TABLE `genre` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genre_name_idx` ON `genre` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `venue_genre` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genre`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `venue_genre_unique_idx` ON `venue_genre` (`venue_id`,`genre_id`);--> statement-breakpoint
CREATE INDEX `venue_genre_genre_idx` ON `venue_genre` (`genre_id`);