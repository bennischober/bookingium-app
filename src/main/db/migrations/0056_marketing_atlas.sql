CREATE TABLE `marketing_atlas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`stand` text DEFAULT '' NOT NULL,
	`run` integer,
	`lead` text DEFAULT '' NOT NULL,
	`facts` text DEFAULT '[]' NOT NULL,
	`refs` text DEFAULT '[]' NOT NULL,
	`tabs` text DEFAULT '[]' NOT NULL,
	`runs` text DEFAULT '[]' NOT NULL,
	`excluded` text DEFAULT '[]' NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_atlas_band_idx` ON `marketing_atlas` (`band_id`);--> statement-breakpoint
CREATE TABLE `marketing_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`category` text NOT NULL,
	`group_name` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'C' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`approach` text DEFAULT '' NOT NULL,
	`timing` text DEFAULT '' NOT NULL,
	`quality` text DEFAULT 'w' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`contact_url` text DEFAULT '' NOT NULL,
	`contact_note` text DEFAULT '' NOT NULL,
	`active_note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`status_note` text DEFAULT '' NOT NULL,
	`status_date` text,
	`company_id` integer,
	`venue_id` integer,
	`in_atlas` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "marketing_item_category_check" CHECK("category" IN ('radios', 'podcasts', 'presse', 'social', 'festivals', 'clubs', 'kanaele', 'sync', 'inspiration', 'ausland')),
	CONSTRAINT "marketing_item_priority_check" CHECK("priority" IN ('A', 'B', 'C')),
	CONSTRAINT "marketing_item_quality_check" CHECK("quality" IN ('b', 'w', 'i')),
	CONSTRAINT "marketing_item_status_check" CHECK("status" IN ('open', 'contacted', 'talking', 'positive', 'declined', 'active'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_item_key_idx` ON `marketing_item` (`band_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `marketing_item_company_idx` ON `marketing_item` (`company_id`);--> statement-breakpoint
CREATE INDEX `marketing_item_venue_idx` ON `marketing_item` (`venue_id`);