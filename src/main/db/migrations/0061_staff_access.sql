CREATE TABLE `employee` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`id_prefix` integer NOT NULL,
	`bridge_device` text DEFAULT '' NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_id_prefix_idx` ON `employee` (`id_prefix`);--> statement-breakpoint
CREATE TABLE `staff_grant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`access` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "staff_grant_entity_check" CHECK("entity" IN ('band', 'deal_memo', 'management_contract', 'invoice', 'event_settlement', 'document', 'receipt', 'trip')),
	CONSTRAINT "staff_grant_access_check" CHECK("access" IN ('shared', 'internal'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_grant_target_idx` ON `staff_grant` (coalesce("employee_id", 0),`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `staff_grant_entity_idx` ON `staff_grant` (`entity`,`entity_id`);