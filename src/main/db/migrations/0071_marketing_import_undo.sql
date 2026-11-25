CREATE TABLE `marketing_import_undo` (
	`band_id` integer PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade
);
