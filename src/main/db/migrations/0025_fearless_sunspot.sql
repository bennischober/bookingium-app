CREATE TABLE `mail_rule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mail_account_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`match_from` text DEFAULT '' NOT NULL,
	`match_to` text DEFAULT '' NOT NULL,
	`match_subject` text DEFAULT '' NOT NULL,
	`move_to_folder_path` text,
	`mark_read` integer DEFAULT false NOT NULL,
	`mark_flagged` integer DEFAULT false NOT NULL,
	`link_entity_type` text,
	`link_entity_id` integer,
	`active_since` text NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_applied_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_rule_account_idx` ON `mail_rule` (`mail_account_id`,`position`);--> statement-breakpoint
CREATE TABLE `mail_rule_hit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`mail_key` text NOT NULL,
	`applied_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `mail_rule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_rule_hit_unique_idx` ON `mail_rule_hit` (`rule_id`,`mail_key`);