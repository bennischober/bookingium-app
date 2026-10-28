CREATE TABLE `mail_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mail_account_id` text NOT NULL,
	`message_id` text,
	`fallback_key` text,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`source` text NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_link_entity_idx` ON `mail_link` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `mail_link_message_idx` ON `mail_link` (`mail_account_id`,`message_id`);