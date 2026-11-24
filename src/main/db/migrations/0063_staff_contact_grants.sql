PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_staff_grant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`access` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "staff_grant_entity_check" CHECK("entity" IN ('band', 'deal_memo', 'management_contract', 'invoice', 'event_settlement', 'document', 'receipt', 'trip', 'person', 'company', 'venue', 'hotel', 'contact_list')),
	CONSTRAINT "staff_grant_access_check" CHECK("access" IN ('shared', 'internal'))
);
--> statement-breakpoint
INSERT INTO `__new_staff_grant`("id", "employee_id", "entity", "entity_id", "access", "created_at", "updated_at") SELECT "id", "employee_id", "entity", "entity_id", "access", "created_at", "updated_at" FROM `staff_grant`;--> statement-breakpoint
DROP TABLE `staff_grant`;--> statement-breakpoint
ALTER TABLE `__new_staff_grant` RENAME TO `staff_grant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `staff_grant_target_idx` ON `staff_grant` (coalesce("employee_id", 0),`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `staff_grant_entity_idx` ON `staff_grant` (`entity`,`entity_id`);