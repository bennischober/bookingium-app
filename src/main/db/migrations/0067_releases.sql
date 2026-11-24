CREATE TABLE `release` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer,
	`artist_name` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`version` text DEFAULT '' NOT NULL,
	`release_type` text DEFAULT 'album' NOT NULL,
	`release_date` text,
	`original_release_date` text,
	`preorder_d2c_date` text,
	`preorder_retail_date` text,
	`preorder_digital_date` text,
	`label` text DEFAULT '' NOT NULL,
	`catalog_number` text DEFAULT '' NOT NULL,
	`p_line` text DEFAULT '' NOT NULL,
	`c_line` text DEFAULT '' NOT NULL,
	`genre` text DEFAULT '' NOT NULL,
	`sub_genre` text DEFAULT '' NOT NULL,
	`metadata_language` text DEFAULT '' NOT NULL,
	`recording_country` text DEFAULT '' NOT NULL,
	`project_number` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "release_type_check" CHECK("release_type" IN ('album', 'ep', 'single', 'compilation', 'other'))
);
--> statement-breakpoint
CREATE INDEX `release_band_idx` ON `release` (`band_id`);--> statement-breakpoint
CREATE INDEX `release_title_idx` ON `release` (`title`);--> statement-breakpoint
CREATE INDEX `release_catalog_number_idx` ON `release` (`catalog_number`);--> statement-breakpoint
CREATE INDEX `release_date_idx` ON `release` (`release_date`);--> statement-breakpoint
CREATE TABLE `release_contributor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`track_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`instrument` text DEFAULT '' NOT NULL,
	`person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `release_track`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `release_contributor_release_idx` ON `release_contributor` (`release_id`);--> statement-breakpoint
CREATE INDEX `release_contributor_track_idx` ON `release_contributor` (`track_id`);--> statement-breakpoint
CREATE INDEX `release_contributor_person_idx` ON `release_contributor` (`person_id`);--> statement-breakpoint
CREATE TABLE `release_product` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`format` text DEFAULT 'digital' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`packaging` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`upc` text DEFAULT '' NOT NULL,
	`catalog_number` text DEFAULT '' NOT NULL,
	`territory` text DEFAULT '' NOT NULL,
	`disc_count` integer,
	`release_date` text,
	`price_code` text DEFAULT '' NOT NULL,
	`box_lot` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "release_product_format_check" CHECK("format" IN ('digital', 'cd', 'vinyl', 'cassette', 'other'))
);
--> statement-breakpoint
CREATE INDEX `release_product_release_idx` ON `release_product` (`release_id`,`position`);--> statement-breakpoint
CREATE INDEX `release_product_upc_idx` ON `release_product` (`upc`);--> statement-breakpoint
CREATE INDEX `release_product_catalog_number_idx` ON `release_product` (`catalog_number`);--> statement-breakpoint
CREATE TABLE `release_product_track` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`track_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`disc` integer DEFAULT 1 NOT NULL,
	`side` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `release_product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `release_track`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_product_track_idx` ON `release_product_track` (`product_id`,`track_id`);--> statement-breakpoint
CREATE INDEX `release_product_track_track_idx` ON `release_product_track` (`track_id`);--> statement-breakpoint
CREATE TABLE `release_track` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`version` text DEFAULT '' NOT NULL,
	`duration_seconds` integer,
	`isrc` text DEFAULT '' NOT NULL,
	`explicit` integer DEFAULT false NOT NULL,
	`genre` text DEFAULT '' NOT NULL,
	`p_line` text DEFAULT '' NOT NULL,
	`c_line` text DEFAULT '' NOT NULL,
	`video_isrc` text DEFAULT '' NOT NULL,
	`lyrics` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `release_track_release_idx` ON `release_track` (`release_id`,`position`);--> statement-breakpoint
CREATE INDEX `release_track_isrc_idx` ON `release_track` (`isrc`);--> statement-breakpoint
CREATE TABLE `release_work_share` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'composer' NOT NULL,
	`share_percent` real,
	`society` text DEFAULT '' NOT NULL,
	`ipi` text DEFAULT '' NOT NULL,
	`publisher` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `release_track`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "release_work_share_role_check" CHECK("role" IN ('lyricist', 'composer', 'arranger', 'other'))
);
--> statement-breakpoint
CREATE INDEX `release_work_share_track_idx` ON `release_work_share` (`track_id`);--> statement-breakpoint
CREATE INDEX `release_work_share_person_idx` ON `release_work_share` (`person_id`);